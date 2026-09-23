import {
  resolveLaunch,
  type DemoUpload,
  type MapEntry,
  type Mode,
  type ServerDriver,
  type ServerDriverName,
  type StartServerRequest,
  type StartServerResponse,
} from "@rushsite/shared"
import { and, asc, eq, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { gsltTokens, hosts, serverSlots, type TeamRosterJson } from "../../db/schema.js"
import { AgentError, type AgentApi } from "./agent.js"
import type { DemoStorage } from "./storage.js"

// AGENT_URLS entries are a url or region=url. Region defaults to eu
export function parseAgentEntry(entry: string): { url: string; region: string } {
  const m = /^([a-z][a-z0-9-]*)=(.+)$/i.exec(entry.trim())
  if (m && !m[1]!.includes(":")) return { region: m[1]!.toLowerCase(), url: m[2]!.trim() }
  return { region: "eu", url: entry.trim() }
}

export type Reservation = { hostId: string; agentUrl: string; slotId: string; gsltId: string; gslt: string }

export type StartParams = {
  matchId: string
  mode: Mode
  map: MapEntry
  teams: TeamRosterJson[]
  password: string
  webhookSecret: string
}

export type AllocationResult =
  | {
      kind: "started"
      driver: ServerDriverName
      // Hetzner host id. DatHost records its clone id through its store
      driverRef: string | null
      hostId: string | null
      response: StartServerResponse
      demo: DemoUpload
    }
  // Nothing free yet. The caller retries on the next tick
  | { kind: "wait" }

// Hosts tried per attempt when agents answer 503
const MAX_HOST_TRIES = 3

// Hetzner hosts running the Go agent. Slots and GSLTs are reserved in Postgres before the agent is called
export class HetznerDriver implements ServerDriver {
  readonly name = "hetzner" as const

  constructor(
    private readonly db: Db,
    private readonly agent: AgentApi,
  ) {}

  async capacity(): Promise<{ free: number; total: number }> {
    const rows = await this.db
      .select({ status: serverSlots.status, n: sql<number>`count(*)::int` })
      .from(serverSlots)
      .innerJoin(hosts, eq(hosts.id, serverSlots.hostId))
      .where(eq(hosts.status, "online"))
      .groupBy(serverSlots.status)
    const total = rows.reduce((s, r) => s + r.n, 0)
    return { free: rows.find((r) => r.status === "free")?.n ?? 0, total }
  }

  private async agentUrlFor(matchId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ agentUrl: hosts.agentUrl })
      .from(serverSlots)
      .innerJoin(hosts, eq(hosts.id, serverSlots.hostId))
      .where(eq(serverSlots.matchId, matchId))
    return row?.agentUrl ?? null
  }

  // Needs a slot reserved for the match first
  async start(req: StartServerRequest): Promise<StartServerResponse> {
    const url = await this.agentUrlFor(req.matchId)
    if (!url) throw new Error(`no hetzner slot reserved for ${req.matchId}`)
    return this.agent.start(url, req)
  }

  async stop(matchId: string): Promise<void> {
    const url = await this.agentUrlFor(matchId)
    if (url) await this.agent.stop(url, matchId)
  }
}

export type AllocatorOptions = {
  webhookBaseUrl: string
  surgeWaitSec: number
}

// Hetzner is base load. DatHost is surge capacity used only after a match waited SURGE_WAIT_SEC for a slot
export class Allocator {
  readonly hetzner: HetznerDriver

  constructor(
    private readonly db: Db,
    private readonly agent: AgentApi,
    private readonly storage: DemoStorage,
    private readonly opts: AllocatorOptions,
    private readonly log: FastifyBaseLogger,
    private surge: ServerDriver | null = null,
  ) {
    this.hetzner = new HetznerDriver(db, agent)
  }

  setSurgeDriver(driver: ServerDriver | null): void {
    this.surge = driver
  }

  driver(name: string | null | undefined): ServerDriver | null {
    if (name === "dathost") return this.surge
    if (name === "hetzner") return this.hetzner
    return null
  }

  async seedGslt(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return
    await this.db
      .insert(gsltTokens)
      .values(tokens.map((token) => ({ token })))
      .onConflictDoNothing()
  }

  // Polls every agent and mirrors capacity into hosts and server_slots
  async syncHosts(agentUrls: string[]): Promise<void> {
    for (const entry of agentUrls) {
      const { url, region } = parseAgentEntry(entry)
      const [host] = await this.db
        .insert(hosts)
        .values({ name: new URL(url).host, agentUrl: url, region })
        .onConflictDoUpdate({ target: hosts.agentUrl, set: { agentUrl: url, region } })
        .returning()
      try {
        const h = await this.agent.health(url)
        const status = h.updating ? "updating" : h.ok ? "online" : "offline"
        await this.db
          .update(hosts)
          .set({
            status,
            cs2Version: h.cs2Version,
            totalSlots: h.slots.total,
            freeSlots: h.slots.free,
            lastSeenAt: new Date(),
          })
          .where(eq(hosts.id, host!.id))
        if (h.slots.total > 0) {
          await this.db
            .insert(serverSlots)
            .values(Array.from({ length: h.slots.total }, (_, i) => ({ hostId: host!.id, slotIndex: i })))
            .onConflictDoNothing()
        }
      } catch (err) {
        this.log.warn({ err, agent: url }, "agent health check failed")
        await this.db.update(hosts).set({ status: "offline" }).where(eq(hosts.id, host!.id))
      }
    }
  }

  private async reserveGslt(tx: Db, matchId: string): Promise<{ id: string; token: string } | null> {
    const [token] = await tx
      .select({ id: gsltTokens.id, token: gsltTokens.token })
      .from(gsltTokens)
      .where(eq(gsltTokens.status, "free"))
      .orderBy(sql`${gsltTokens.lastUsedAt} asc nulls first`)
      .limit(1)
      .for("update", { skipLocked: true })
    if (!token) return null
    await tx
      .update(gsltTokens)
      .set({ status: "in_use", matchId, lastUsedAt: new Date() })
      .where(eq(gsltTokens.id, token.id))
    return token
  }

  // Reserves a free Hetzner slot on an online host and a GSLT. Returns null when either is exhausted
  async reserve(matchId: string): Promise<Reservation | null> {
    return this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db
      const [slot] = await tx
        .select({ slotId: serverSlots.id, hostId: hosts.id, agentUrl: hosts.agentUrl })
        .from(serverSlots)
        .innerJoin(hosts, eq(hosts.id, serverSlots.hostId))
        .where(and(eq(serverSlots.status, "free"), eq(hosts.status, "online")))
        .orderBy(asc(hosts.createdAt), asc(serverSlots.slotIndex))
        .limit(1)
        .for("update", { of: serverSlots, skipLocked: true })
      if (!slot) return null
      const token = await this.reserveGslt(tx, matchId)
      if (!token) return null
      await tx
        .update(serverSlots)
        .set({ status: "reserved", matchId, updatedAt: new Date() })
        .where(eq(serverSlots.id, slot.slotId))
      return { hostId: slot.hostId, agentUrl: slot.agentUrl, slotId: slot.slotId, gsltId: token.id, gslt: token.token }
    })
  }

  async reservationFor(matchId: string): Promise<Reservation | null> {
    const [slot] = await this.db
      .select({ slotId: serverSlots.id, hostId: hosts.id, agentUrl: hosts.agentUrl })
      .from(serverSlots)
      .innerJoin(hosts, eq(hosts.id, serverSlots.hostId))
      .where(eq(serverSlots.matchId, matchId))
    const [token] = await this.db
      .select({ id: gsltTokens.id, token: gsltTokens.token })
      .from(gsltTokens)
      .where(eq(gsltTokens.matchId, matchId))
    if (!slot || !token) return null
    return { hostId: slot.hostId, agentUrl: slot.agentUrl, slotId: slot.slotId, gsltId: token.id, gslt: token.token }
  }

  buildRequest(p: StartParams, gslt: string, demoUpload: DemoUpload): StartServerRequest {
    return {
      matchId: p.matchId,
      mode: p.mode,
      map: p.map,
      gslt,
      password: p.password,
      allowedSteamIds: p.teams.flatMap((t) => t.steamIds),
      teams: p.teams.map((t) => ({ name: t.name, steamIds: [...t.steamIds], ...(t.displayName ? { displayName: t.displayName } : {}) })),
      webhookUrl: `${this.opts.webhookBaseUrl.replace(/\/+$/, "")}/webhooks/match/${p.matchId}`,
      webhookSecret: p.webhookSecret,
      demoUpload,
      cs2: resolveLaunch(p.mode, p.map),
    }
  }

  // Tries every Hetzner host first, then DatHost once the match has waited long enough
  async allocate(p: StartParams, waitedMs: number): Promise<AllocationResult> {
    for (let attempt = 0; attempt < MAX_HOST_TRIES; attempt++) {
      const res = (await this.reservationFor(p.matchId)) ?? (await this.reserve(p.matchId))
      if (!res) break
      const demo = await this.storage.presignUpload(p.matchId)
      try {
        const response = await this.hetzner.start(this.buildRequest(p, res.gslt, demo))
        await this.db
          .update(serverSlots)
          .set({ status: "running", port: response.port, updatedAt: new Date() })
          .where(eq(serverSlots.id, res.slotId))
        return { kind: "started", driver: "hetzner", driverRef: res.hostId, hostId: res.hostId, response, demo }
      } catch (err) {
        // A busy or updating host is taken out until the next health sync and the next host is tried
        const busy = err instanceof AgentError && err.status === 503
        if (busy) await this.db.update(hosts).set({ status: "updating" }).where(eq(hosts.id, res.hostId))
        await this.release(p.matchId, "hetzner", !busy)
        if (!busy) throw err
      }
    }

    if (this.surge && waitedMs >= this.opts.surgeWaitSec * 1000) {
      const token = await this.db.transaction((tx) => this.reserveGslt(tx as unknown as Db, p.matchId))
      if (!token) return { kind: "wait" }
      const demo = await this.storage.presignUpload(p.matchId)
      try {
        const response = await this.surge.start(this.buildRequest(p, token.token, demo))
        this.log.info({ matchId: p.matchId, driver: this.surge.name }, "match allocated on surge capacity")
        return { kind: "started", driver: this.surge.name, driverRef: null, hostId: null, response, demo }
      } catch (err) {
        await this.release(p.matchId, this.surge.name, false)
        throw err
      }
    }
    return { kind: "wait" }
  }

  // Frees the slot and token, and stops the server through the driver that started it
  async release(matchId: string, driverName: string | null, stopServer: boolean): Promise<void> {
    const driver = this.driver(driverName) ?? this.hetzner
    if (stopServer) {
      try {
        await driver.stop(matchId)
      } catch (err) {
        this.log.warn({ err, matchId, driver: driver.name }, "server stop failed")
      }
    }
    const now = new Date()
    await this.db
      .update(serverSlots)
      .set({ status: "free", matchId: null, port: null, updatedAt: now })
      .where(eq(serverSlots.matchId, matchId))
    await this.db
      .update(gsltTokens)
      .set({ status: "free", matchId: null, lastUsedAt: now })
      .where(eq(gsltTokens.matchId, matchId))
  }

  // DatHost keeps the demo on its server. Pull it before the server is deleted and store it like a plugin upload
  async collectDemo(matchId: string, driverName: string | null, key: string): Promise<boolean> {
    const driver = this.driver(driverName)
    if (!driver?.fetchDemo || !this.storage.enabled) return false
    const body = await driver.fetchDemo(matchId)
    if (!body) return false
    await this.storage.upload(key, body)
    return true
  }

  async hostsWithSlots(): Promise<(typeof hosts.$inferSelect & { slots: (typeof serverSlots.$inferSelect)[] })[]> {
    const hs = await this.db.select().from(hosts).orderBy(asc(hosts.createdAt))
    const slots = await this.db.select().from(serverSlots).orderBy(asc(serverSlots.slotIndex))
    return hs.map((h) => ({ ...h, slots: slots.filter((s) => s.hostId === h.id) }))
  }
}
