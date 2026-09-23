import { PRESENCE_TTL_SEC, type FriendUpdatePayload, type Presence, type PresenceDetail } from "@rushsite/shared"
import { and, desc, eq, inArray, or } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { matchPlayers, matches } from "../../db/schema.js"
import type { PartyService } from "../parties/service.js"
import { ACTIVE_MATCH_STATUSES, type QueueService } from "../queue/service.js"
import { toUsers, type Notifier } from "../ws/hub.js"
import { friendships } from "./schema.js"

type LiveState = Exclude<Presence, "offline">
export type PresenceEntry = { state: Presence; detail?: PresenceDetail }
type LiveEntry = { state: LiveState; detail?: PresenceDetail }
type MatchRow = typeof matches.$inferSelect

const key = (steamId: string) => `presence:${steamId}`
// Last refresh per user so the sweep can tell friends when a key lapses
const SEEN = "presence:seen"
const OFFLINE: PresenceEntry = { state: "offline" }

function parse(raw: string | null): PresenceEntry {
  if (!raw) return OFFLINE
  try {
    return JSON.parse(raw) as PresenceEntry
  } catch {
    return OFFLINE
  }
}

// Score and match fields as seen by one player, their team first
export function matchDetail(m: Pick<MatchRow, "id" | "mode" | "mapId" | "teams" | "score">, steamId: string): PresenceDetail {
  const idx = Math.max(0, m.teams.findIndex((t) => t.steamIds.includes(steamId)))
  const own = m.teams[idx]
  const opp = m.teams[1 - idx]
  const score = (name?: string) => (name ? (m.score?.[name] ?? 0) : 0)
  return { matchId: m.id, mode: m.mode, mapId: m.mapId ?? null, score: [score(own?.name), score(opp?.name)] }
}

export type PresenceDeps = {
  db: Db
  redis: Redis
  notifier: Notifier
  queue: QueueService
  parties: PartyService
  log: FastifyBaseLogger
  now: () => number
}

// Online, queue and match state in Redis with a small detail blob. A missing key means offline.
// Readers only touch Redis. Postgres is read on transitions, once per player or once per match
export class PresenceService {
  constructor(private readonly d: PresenceDeps) {}

  async get(steamIds: string[]): Promise<Map<string, PresenceEntry>> {
    const out = new Map<string, PresenceEntry>()
    if (steamIds.length === 0) return out
    const raws = await this.d.redis.mget(...steamIds.map(key))
    steamIds.forEach((id, i) => out.set(id, parse(raws[i] ?? null)))
    return out
  }

  async getOne(steamId: string): Promise<PresenceEntry> {
    return parse(await this.d.redis.get(key(steamId)))
  }

  // Works out the state from the queue and active matches
  async compute(steamId: string): Promise<LiveEntry> {
    const [row] = await this.d.db
      .select({ m: matches })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), inArray(matches.status, [...ACTIVE_MATCH_STATUSES])))
      .orderBy(desc(matches.createdAt))
      .limit(1)
    if (row) return { state: "match", detail: matchDetail(row.m, steamId) }
    const party = await this.d.parties.partyOf(steamId)
    const ticket = party ? await this.d.queue.ticketForParty(party.partyId) : null
    if (ticket) return { state: "queue", detail: { modes: [...ticket.modes] } }
    return { state: "online" }
  }

  private async write(steamId: string, entry: LiveEntry): Promise<void> {
    const raw = JSON.stringify(entry)
    const prev = await this.d.redis.get(key(steamId))
    await this.d.redis.multi().set(key(steamId), raw, "EX", PRESENCE_TTL_SEC).zadd(SEEN, this.d.now(), steamId).exec()
    if (prev !== raw) await this.push(steamId, entry)
  }

  // Called on socket connect and every pong. Keeps the current state alive
  async heartbeat(steamId: string): Promise<void> {
    const ok = await this.d.redis.expire(key(steamId), PRESENCE_TTL_SEC)
    if (ok === 1) {
      await this.d.redis.zadd(SEEN, this.d.now(), steamId)
      return
    }
    await this.write(steamId, await this.compute(steamId))
  }

  // Queue and match transitions. Recomputes each player and pushes changes
  async refresh(steamIds: string[]): Promise<void> {
    for (const id of new Set(steamIds)) {
      try {
        await this.write(id, await this.compute(id))
      } catch (err) {
        this.d.log.warn({ err, steamId: id }, "presence refresh failed")
      }
    }
  }

  // Map pick, start and every round. Uses the row the match flow already loaded
  async matchChanged(m: MatchRow): Promise<void> {
    if (!(ACTIVE_MATCH_STATUSES as readonly string[]).includes(m.status)) return
    for (const id of m.teams.flatMap((t) => t.steamIds)) {
      try {
        await this.write(id, { state: "match", detail: matchDetail(m, id) })
      } catch (err) {
        this.d.log.warn({ err, steamId: id }, "presence match update failed")
      }
    }
  }

  async markOffline(steamId: string): Promise<void> {
    const removed = await this.d.redis.del(key(steamId))
    await this.d.redis.zrem(SEEN, steamId)
    if (removed > 0) await this.push(steamId, OFFLINE)
  }

  // Tells friends about keys that lapsed without a heartbeat
  async sweep(): Promise<string[]> {
    const cutoff = this.d.now() - PRESENCE_TTL_SEC * 1000
    const stale = await this.d.redis.zrangebyscore(SEEN, 0, cutoff)
    const gone: string[] = []
    for (const id of stale) {
      if ((await this.d.redis.exists(key(id))) === 1) {
        await this.d.redis.zadd(SEEN, this.d.now(), id)
        continue
      }
      await this.d.redis.zrem(SEEN, id)
      await this.push(id, OFFLINE)
      gone.push(id)
    }
    return gone
  }

  async friendIdsOf(steamId: string): Promise<string[]> {
    const rows = await this.d.db
      .select({ a: friendships.userA, b: friendships.userB })
      .from(friendships)
      .where(and(eq(friendships.status, "accepted"), or(eq(friendships.userA, steamId), eq(friendships.userB, steamId))))
    return rows.map((r) => (r.a === steamId ? r.b : r.a))
  }

  // Presence only ever goes to the player's friends
  private async push(steamId: string, entry: PresenceEntry): Promise<void> {
    const friends = await this.friendIdsOf(steamId)
    const payload: FriendUpdatePayload = {
      kind: "presence",
      steamId,
      presence: entry.state,
      ...(entry.detail ? { detail: entry.detail } : {}),
    }
    toUsers(this.d.notifier, friends, "friend_update", payload)
  }
}
