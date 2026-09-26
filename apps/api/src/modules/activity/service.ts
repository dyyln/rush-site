import { pageRoute } from "@rushsite/shared"
import { eq, inArray, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { matches, matchPlayers } from "../../db/schema.js"
import type { MatchResultEvent } from "../match/flow.js"
import { activityEvents, userActivity } from "./schema.js"

export const ACTIVITY_KINDS = [
  "session_start",
  "page_view",
  "queue_join",
  "queue_leave",
  "queue_matched",
  "match_found",
  "match_accept",
  "match_decline",
  "match_missed",
  "match_start",
  "match_end",
  "cup_signup",
  "cup_withdraw",
  "discord_link",
  "discord_unlink",
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export type ActivityInput = {
  kind: ActivityKind
  mode?: string | null
  ref?: string | null
  detail?: string | null
  value?: number | null
}

// A socket that opens this long after the player was last seen starts a new session
export const SESSION_GAP_MS = 30 * 60_000
// Pongs refresh last seen at most this often per player
const SEEN_EVERY_MS = 2 * 60_000

type Counter = keyof Pick<
  typeof userActivity.$inferInsert,
  | "sessions"
  | "pageViews"
  | "queueJoins"
  | "matchesFound"
  | "matchesAccepted"
  | "matchesDeclined"
  | "matchesMissed"
  | "matchesPlayed"
  | "matchesWon"
  | "cupSignups"
>

// The counters an event adds one to
function countersFor(e: ActivityInput): Counter[] {
  switch (e.kind) {
    case "session_start":
      return ["sessions"]
    case "page_view":
      return ["pageViews"]
    case "queue_join":
      return e.detail === "requeue" ? [] : ["queueJoins"]
    case "match_found":
      return ["matchesFound"]
    case "match_accept":
      return ["matchesAccepted"]
    case "match_decline":
      return ["matchesDeclined"]
    case "match_missed":
      return ["matchesMissed"]
    case "match_end":
      if (e.detail === "win") return ["matchesPlayed", "matchesWon"]
      return e.detail === "loss" ? ["matchesPlayed"] : []
    case "cup_signup":
      return ["cupSignups"]
    default:
      return []
  }
}

// Writes activity events and keeps the per player totals. Failures are logged and never reach the caller
export class ActivityService {
  private readonly pending = new Set<Promise<void>>()
  private readonly lastSeenWrite = new Map<string, number>()
  private readonly lastPage = new Map<string, { key: string; at: number }>()

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  // Fire and forget. Tests await flush
  record(steamIds: string[], e: ActivityInput): void {
    if (steamIds.length === 0) return
    this.track(this.write([...new Set(steamIds)], e, new Date(this.now())))
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  private track(p: Promise<void>): void {
    const safe = p.catch((err: unknown) => this.log.warn({ err }, "activity write failed"))
    this.pending.add(safe)
    void safe.finally(() => this.pending.delete(safe))
  }

  private async write(steamIds: string[], e: ActivityInput, at: Date): Promise<void> {
    const row = { kind: e.kind, mode: e.mode ?? null, ref: e.ref ?? null, detail: e.detail ?? null, value: e.value ?? null, at }
    await this.db.insert(activityEvents).values(steamIds.map((steamId) => ({ steamId, ...row })))
    const inc = Object.fromEntries(countersFor(e).map((c) => [c, 1])) as Partial<Record<Counter, number>>
    const queueSeconds = (e.kind === "queue_leave" || e.kind === "queue_matched") && e.value ? e.value : 0
    const action = e.kind !== "session_start"
    const page = e.kind === "page_view" ? e.detail : null
    const set: Record<string, unknown> = { lastSeenAt: sql`greatest(${userActivity.lastSeenAt}, excluded.last_seen_at)` }
    for (const c of Object.keys(inc) as Counter[]) set[c] = sql`${userActivity[c]} + 1`
    if (queueSeconds) set.queueSeconds = sql`${userActivity.queueSeconds} + ${queueSeconds}`
    if (action) {
      set.lastAction = row.kind
      set.lastActionDetail = row.detail
      set.lastActionMode = row.mode
      set.lastActionAt = at
    }
    if (page) set.lastPage = page
    for (const steamId of steamIds) {
      await this.db
        .insert(userActivity)
        .values({
          steamId,
          ...inc,
          queueSeconds,
          firstSeenAt: at,
          lastSeenAt: at,
          ...(action ? { lastAction: row.kind, lastActionDetail: row.detail, lastActionMode: row.mode, lastActionAt: at } : {}),
          ...(page ? { lastPage: page } : {}),
        })
        .onConflictDoUpdate({ target: userActivity.steamId, set })
    }
  }

  // A socket opened. Starts a session when the player was away long enough
  connected(steamId: string): void {
    this.track(
      (async () => {
        const at = this.now()
        this.lastSeenWrite.set(steamId, at)
        const [row] = await this.db
          .select({ lastSeenAt: userActivity.lastSeenAt })
          .from(userActivity)
          .where(eq(userActivity.steamId, steamId))
        if (!row || at - row.lastSeenAt.getTime() > SESSION_GAP_MS) {
          this.lastPage.delete(steamId)
          await this.write([steamId], { kind: "session_start" }, new Date(at))
        } else await this.touch(steamId, at)
      })(),
    )
  }

  // Keeps last seen fresh while a socket is open. force writes straight away, for a socket closing
  seen(steamId: string, force = false): void {
    const at = this.now()
    const last = this.lastSeenWrite.get(steamId) ?? 0
    if (!force && at - last < SEEN_EVERY_MS) return
    this.lastSeenWrite.set(steamId, at)
    if (force) this.lastSeenWrite.delete(steamId)
    this.track(this.touch(steamId, at))
  }

  private async touch(steamId: string, at: number): Promise<void> {
    await this.db
      .update(userActivity)
      .set({ lastSeenAt: sql`greatest(${userActivity.lastSeenAt}, ${new Date(at).toISOString()}::timestamptz)` })
      .where(eq(userActivity.steamId, steamId))
  }

  // The same page again within a session is not a new view. A reconnect sends the page again
  pageView(steamId: string, path: string): void {
    const page = pageRoute(path)
    if (!page) return
    const key = `${page.route}|${page.ref ?? ""}`
    const at = this.now()
    const prev = this.lastPage.get(steamId)
    if (prev && prev.key === key && at - prev.at < SESSION_GAP_MS) {
      this.seen(steamId)
      return
    }
    this.lastPage.set(steamId, { key, at })
    this.lastSeenWrite.set(steamId, at)
    this.record([steamId], { kind: "page_view", detail: page.route, ref: page.ref })
  }

  // One match_end per player with win, loss, forfeit, abandoned or cancelled
  onMatchResult(result: MatchResultEvent): void {
    this.track(
      (async () => {
        const [m] = await this.db
          .select({ mode: matches.mode, startedAt: matches.startedAt, endedAt: matches.endedAt })
          .from(matches)
          .where(eq(matches.id, result.matchId))
        if (!m) return
        const players = await this.db
          .select({ steamId: matchPlayers.steamId, won: matchPlayers.won })
          .from(matchPlayers)
          .where(inArray(matchPlayers.matchId, [result.matchId]))
        const played = m.startedAt ? Math.max(0, ((m.endedAt?.getTime() ?? this.now()) - m.startedAt.getTime()) / 1000) : null
        const at = new Date(this.now())
        const groups = new Map<string, string[]>()
        for (const p of players) {
          let detail: string
          if (result.outcome === "completed") detail = p.won ? "win" : "loss"
          else if (result.outcome === "abandoned") detail = result.missingSteamIds.includes(p.steamId) ? "forfeit" : "abandoned"
          else detail = "cancelled"
          groups.set(detail, [...(groups.get(detail) ?? []), p.steamId])
        }
        for (const [detail, ids] of groups) {
          await this.write(ids, { kind: "match_end", mode: m.mode, ref: result.matchId, detail, value: played }, at)
        }
      })(),
    )
  }
}
