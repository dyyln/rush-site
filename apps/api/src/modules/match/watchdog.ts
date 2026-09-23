import type { Mode, ServerLiveness } from "@rushsite/shared"
import { inArray } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { hosts, matches } from "../../db/schema.js"
import type { AgentApi } from "./agent.js"
import type { Allocator } from "./allocator.js"

type MatchRow = typeof matches.$inferSelect

// Statuses where a server should be running for the match
export const WATCHED_STATUSES = ["starting", "ready", "live"] as const

export const SERVER_LOST = "server_lost"
export const MATCH_TIMEOUT = "timeout"
export type WatchdogReason = typeof SERVER_LOST | typeof MATCH_TIMEOUT

// Generous caps. Aim is first to 16 and Rush has at most 15 rounds
export const DEFAULT_MAX_DURATION_MIN: Record<Mode, number> = { aim1v1: 45, aim2v2: 45, rush3v3: 40 }

export type WatchdogOptions = {
  // Minutes from match start, or from server ready or allocation when it never started
  maxDurationMin: Record<Mode, number>
  // A live match whose server state is unknown is lost after this long without a webhook
  silenceSec: number
  // Seconds between passes inside the allocation loop
  intervalSec: number
}

export type WatchdogVerdict = { matchId: string; reason: WatchdogReason; detail: string }

export type WatchdogDeps = {
  db: Db
  redis: Redis
  allocator: Allocator
  agent: AgentApi
  log: FastifyBaseLogger
  now?: () => number
  options?: Partial<WatchdogOptions>
}

const LAST_EVENT_TTL_SEC = 24 * 60 * 60

export const lastEventKey = (matchId: string) => `match:last_event:${matchId}`

// Finds matches whose server is gone or that ran past the mode's cap. Ending them is up to the caller
export class MatchWatchdog {
  readonly options: WatchdogOptions
  private readonly now: () => number

  constructor(private readonly d: WatchdogDeps) {
    this.now = d.now ?? Date.now
    this.options = {
      maxDurationMin: { ...DEFAULT_MAX_DURATION_MIN, ...(d.options?.maxDurationMin ?? {}) },
      silenceSec: d.options?.silenceSec ?? 15 * 60,
      intervalSec: d.options?.intervalSec ?? 30,
    }
  }

  // Called for every webhook so a silent server can be told apart from a busy one
  async touch(matchId: string): Promise<void> {
    await this.d.redis.set(lastEventKey(matchId), String(this.now()), "EX", LAST_EVENT_TTL_SEC)
  }

  async lastEventAt(m: MatchRow): Promise<number> {
    const raw = await this.d.redis.get(lastEventKey(m.id))
    const fromRedis = raw ? Number(raw) : NaN
    const fallback = (m.startedAt ?? m.readyAt ?? m.allocationStartedAt ?? m.createdAt).getTime()
    return Number.isFinite(fromRedis) ? Math.max(fromRedis, fallback) : fallback
  }

  deadline(m: MatchRow): number {
    const from = m.startedAt ?? m.readyAt ?? m.allocationStartedAt ?? m.createdAt
    return from.getTime() + this.options.maxDurationMin[m.mode] * 60_000
  }

  async inspect(): Promise<WatchdogVerdict[]> {
    const rows = await this.d.db.select().from(matches).where(inArray(matches.status, [...WATCHED_STATUSES]))
    if (rows.length === 0) return []
    const liveness = await this.liveness(rows)
    const now = this.now()
    const out: WatchdogVerdict[] = []
    for (const m of rows) {
      const state = liveness.get(m.id) ?? "unknown"
      if (state === "gone") {
        out.push({ matchId: m.id, reason: SERVER_LOST, detail: `${m.driver ?? "unknown"} has no server for the match` })
        continue
      }
      if (now > this.deadline(m)) {
        out.push({ matchId: m.id, reason: MATCH_TIMEOUT, detail: `over ${this.options.maxDurationMin[m.mode]} min` })
        continue
      }
      if (state === "unknown" && m.status === "live" && now - (await this.lastEventAt(m)) > this.options.silenceSec * 1000) {
        out.push({ matchId: m.id, reason: SERVER_LOST, detail: `no webhook for ${this.options.silenceSec} s and no server status` })
      }
    }
    return out
  }

  // One GET /servers per host. Anything we cannot confirm either way is unknown
  private async liveness(rows: MatchRow[]): Promise<Map<string, ServerLiveness>> {
    const out = new Map<string, ServerLiveness>()
    const byHost = new Map<string, MatchRow[]>()
    for (const m of rows) {
      if (m.driver === "hetzner" && m.hostId) byHost.set(m.hostId, [...(byHost.get(m.hostId) ?? []), m])
    }
    if (byHost.size > 0 && this.d.agent.list) {
      const hostRows = await this.d.db
        .select({ id: hosts.id, agentUrl: hosts.agentUrl })
        .from(hosts)
        .where(inArray(hosts.id, [...byHost.keys()]))
      for (const h of hostRows) {
        try {
          const running = new Set((await this.d.agent.list(h.agentUrl)).map((s) => s.matchId))
          for (const m of byHost.get(h.id) ?? []) out.set(m.id, running.has(m.id) ? "alive" : "gone")
        } catch (err) {
          this.d.log.warn({ err, agent: h.agentUrl }, "watchdog could not list servers")
        }
      }
    }
    for (const m of rows) {
      if (m.driver === "hetzner" || !m.driver) continue
      const driver = this.d.allocator.driver(m.driver)
      if (!driver?.status) continue
      try {
        out.set(m.id, await driver.status(m.id))
      } catch (err) {
        this.d.log.warn({ err, matchId: m.id, driver: m.driver }, "watchdog could not read server status")
      }
    }
    return out
  }

  async forget(matchId: string): Promise<void> {
    await this.d.redis.del(lastEventKey(matchId))
  }
}

export const isWatched = (status: string) => (WATCHED_STATUSES as readonly string[]).includes(status)
