import {
  MODES,
  allowedModesForParty,
  maxRatingDiffAfter,
  unresolvedConfig,
  type Mode,
  type QueueModeStatus,
  type QueueStatusPayload,
} from "@rushsite/shared"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { matchPlayers, matches, queueTickets } from "../../db/schema.js"
import { ApiError, badRequest, conflict, forbidden } from "../../lib/errors.js"
import type { PartyService } from "../parties/service.js"
import type { RatingService } from "../rating/service.js"
import type { TrustService } from "../trust/service.js"
import { toUsers, type Notifier } from "../ws/hub.js"
import type { CooldownService } from "./cooldowns.js"
import type { MmTicket } from "./matchmaker.js"

// Live queue state kept in Redis. Postgres queue_tickets is the durable record
export type LiveTicket = {
  id: string
  partyId: string
  modes: Mode[]
  steamIds: string[]
  ratings: Partial<Record<Mode, number>>
  region: string
  enqueuedAt: number
}

export const ACTIVE_MATCH_STATUSES = ["accepting", "veto", "allocating", "starting", "ready", "live"] as const

const K = {
  queue: (mode: Mode) => `q:${mode}`,
  ticket: (id: string) => `q:t:${id}`,
  party: (partyId: string) => `q:p:${partyId}`,
  // Players queued per mode. Kept up to date on every add and remove
  size: (mode: Mode) => `q:size:${mode}`,
  // Per mode aggregate shared by every API instance
  aggregate: "q:agg",
}

const AGGREGATE_TTL_MS = 2000
const MGET_CHUNK = 1000
const IN_PROGRESS_STATUSES = ["starting", "ready", "live"] as const

// Figures that are the same for every ticket in a mode
export type ModeAggregate = { playersInQueue: number; estimatedSec: number | null; matchesInProgress: number }
export type QueueAggregate = { at: number; modes: Record<Mode, ModeAggregate> }
export type RefreshResult = { tickets: number; players: number }

export type QueueOptions = {
  // Lets modes with placeholder config queue anyway, for local testing
  allowUnresolvedModes?: boolean
}

export type ClaimResult = { ok: true } | { ok: false; lost: string[] }

export function toMmTicket(t: LiveTicket, mode: Mode): MmTicket {
  return { id: t.id, size: t.steamIds.length, rating: t.ratings[mode] ?? 1500, enqueuedAt: t.enqueuedAt, region: t.region }
}

export type EtaSource = (mode: Mode) => Promise<number | null>
// Returns the reason a mode cannot queue, or null when it can
export type AvailabilitySource = (mode: Mode) => Promise<string | null>

export class QueueService {
  private eta: EtaSource | null = null
  private playerHooks: ((steamIds: string[]) => Promise<void>)[] = []
  private availability: AvailabilitySource | null = null
  // Set when the ETA source changes so the next read skips the shared cache
  private aggregateStale = false
  private aggregateInFlight: Promise<QueueAggregate> | null = null

  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly notifier: Notifier,
    private readonly parties: PartyService,
    private readonly cooldowns: CooldownService,
    private readonly ratings: RatingService,
    private readonly trust: TrustService,
    private readonly now: () => number = Date.now,
    private readonly opts: QueueOptions = {},
  ) {
    parties.onChange(async (partyId) => {
      await this.cancelParty(partyId, "party_changed")
    })
  }

  // Runs after any queue change for these players. Presence uses it
  onPlayersChanged(hook: (steamIds: string[]) => Promise<void>): void {
    this.playerHooks.push(hook)
  }

  // Supplies QueueModeStatus.estimatedSec. The stats module installs it
  setEtaSource(source: EtaSource | null): void {
    this.eta = source
    this.aggregateStale = true
  }

  // Blocks joins for modes the status page reports as unavailable. The stats module installs it
  setAvailabilitySource(source: AvailabilitySource | null): void {
    this.availability = source
  }

  // Joins one or more modes. Joining again while queued adds modes and keeps the original queue time
  async join(steamId: string, modes: Mode[]): Promise<LiveTicket> {
    const wanted = [...new Set(modes)]
    if (wanted.length === 0) throw badRequest("no_modes")
    if (!this.opts.allowUnresolvedModes) {
      const blocked = wanted.filter((m) => unresolvedConfig(m).length > 0)
      if (blocked.length > 0) throw new ApiError(503, "mode_unavailable", `not configured yet: ${blocked.join(",")}`)
    }
    if (this.availability) {
      for (const m of wanted) {
        const reason = await this.availability(m)
        if (reason) throw new ApiError(503, "mode_unavailable", `${m}: ${reason}`)
      }
    }
    const party = await this.parties.ensure(steamId)
    if (party.leaderSteamId !== steamId) throw forbidden("not_leader", "only the party leader can queue")
    const size = party.memberSteamIds.length
    const allowed = allowedModesForParty(size)
    const tooSmall = wanted.filter((m) => !allowed.includes(m))
    if (tooSmall.length > 0) throw badRequest("party_too_large", `party of ${size} cannot queue ${tooSmall.join(",")}`)

    const banned = await this.trust.activeBans(party.memberSteamIds)
    if (banned.size > 0) throw forbidden("banned", [...banned].join(","))
    const cds = await this.cooldowns.active(party.memberSteamIds)
    if (cds.size > 0) {
      const until = Math.max(...[...cds.values()].map((c) => c.endsAt))
      throw new ApiError(409, "cooldown", `queue cooldown until ${new Date(until).toISOString()}`)
    }
    if ((await this.inActiveMatch(party.memberSteamIds)).length > 0) throw conflict("in_match")

    const ratings: Partial<Record<Mode, number>> = {}
    for (const m of wanted) {
      const map = await this.ratings.get(party.memberSteamIds, m)
      ratings[m] = [...map.values()].reduce((s, r) => s + r.rating, 0) / size
    }

    const existing = await this.ticketForParty(party.partyId)
    if (existing) {
      const merged: LiveTicket = {
        ...existing,
        modes: [...new Set([...existing.modes, ...wanted])],
        ratings: { ...existing.ratings, ...ratings },
      }
      await this.db
        .update(queueTickets)
        .set({ modes: merged.modes, ratings: merged.ratings, updatedAt: new Date(this.now()) })
        .where(and(eq(queueTickets.id, existing.id), eq(queueTickets.status, "waiting")))
      await this.putLive(merged)
      await this.assertRoster(merged)
      await this.notifyParty(merged.steamIds)
      return merged
    }

    const enqueuedAt = this.now()
    // The partial unique index allows one waiting ticket per party. A concurrent join that lost gets the winner's ticket
    const [row] = await this.db
      .insert(queueTickets)
      .values({
        partyId: party.partyId,
        modes: wanted,
        steamIds: party.memberSteamIds,
        ratings,
        enqueuedAt: new Date(enqueuedAt),
      })
      .onConflictDoNothing({ target: queueTickets.partyId, where: sql`status = 'waiting'` })
      .returning({ id: queueTickets.id })
    if (!row) return this.joinExisting(party.partyId, wanted, ratings)
    const ticket: LiveTicket = {
      id: row!.id,
      partyId: party.partyId,
      modes: wanted,
      steamIds: party.memberSteamIds,
      ratings,
      region: "eu",
      enqueuedAt,
    }
    await this.putLive(ticket)
    await this.assertRoster(ticket)
    await this.notifyParty(ticket.steamIds)
    return ticket
  }

  // A member may join or leave while the leader queues. The party change hook only sees tickets already in Redis,
  // so the roster is read again once the ticket is live. Either this check or the hook catches every change
  private async assertRoster(ticket: LiveTicket): Promise<void> {
    const party = await this.parties.get(ticket.partyId)
    const members = party?.memberSteamIds ?? []
    if (members.length === ticket.steamIds.length && ticket.steamIds.every((id) => members.includes(id))) return
    await this.dropLive(ticket)
    await this.cancelTicket(ticket.id, "party_changed", true)
    await this.notifyParty([...new Set([...ticket.steamIds, ...members])])
    throw conflict("party_changed", "the party changed while joining the queue")
  }

  // Adds the ticket to the waiting row of another join that won the insert
  private async joinExisting(partyId: string, wanted: Mode[], ratings: Partial<Record<Mode, number>>): Promise<LiveTicket> {
    const [row] = await this.db
      .select()
      .from(queueTickets)
      .where(and(eq(queueTickets.partyId, partyId), eq(queueTickets.status, "waiting")))
    if (!row) throw conflict("queue_busy", "queue changed during join, try again")
    const modes = [...new Set([...row.modes, ...wanted])]
    const merged: LiveTicket = {
      id: row.id,
      partyId: row.partyId,
      modes,
      steamIds: row.steamIds,
      ratings: { ...row.ratings, ...ratings },
      region: row.region,
      enqueuedAt: row.enqueuedAt.getTime(),
    }
    if (modes.length !== row.modes.length) {
      await this.db
        .update(queueTickets)
        .set({ modes, ratings: merged.ratings, updatedAt: new Date(this.now()) })
        .where(and(eq(queueTickets.id, row.id), eq(queueTickets.status, "waiting")))
    }
    await this.putLive(merged)
    await this.assertRoster(merged)
    await this.notifyParty(merged.steamIds)
    return merged
  }

  // Queue sizes move only when a zadd or zrem really changed the set, so repeats do not double count
  private async putLive(ticket: LiveTicket, previousModes: Mode[] = []): Promise<void> {
    const removed = previousModes.filter((m) => !ticket.modes.includes(m))
    const tx = this.redis.multi().set(K.ticket(ticket.id), JSON.stringify(ticket)).set(K.party(ticket.partyId), ticket.id)
    for (const m of removed) tx.zrem(K.queue(m), ticket.id)
    for (const m of ticket.modes) tx.zadd(K.queue(m), ticket.enqueuedAt, ticket.id)
    const res = await tx.exec()
    const changed = (i: number) => Number(res?.[2 + i]?.[1] ?? 0) > 0
    const size = ticket.steamIds.length
    const down = removed.filter((_, i) => changed(i))
    const up = ticket.modes.filter((_, i) => changed(removed.length + i))
    if (down.length + up.length === 0) return
    const adj = this.redis.pipeline()
    for (const m of down) adj.decrby(K.size(m), size)
    for (const m of up) adj.incrby(K.size(m), size)
    await adj.exec()
  }

  private async dropLive(ticket: LiveTicket): Promise<void> {
    const tx = this.redis.multi().del(K.ticket(ticket.id)).del(K.party(ticket.partyId))
    for (const m of ticket.modes) tx.zrem(K.queue(m), ticket.id)
    const res = await tx.exec()
    const gone = ticket.modes.filter((_, i) => Number(res?.[2 + i]?.[1] ?? 0) > 0)
    if (gone.length === 0) return
    const adj = this.redis.pipeline()
    for (const m of gone) adj.decrby(K.size(m), ticket.steamIds.length)
    await adj.exec()
  }

  async inActiveMatch(steamIds: string[]): Promise<string[]> {
    if (steamIds.length === 0) return []
    const rows = await this.db
      .select({ steamId: matchPlayers.steamId })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(inArray(matchPlayers.steamId, steamIds), inArray(matches.status, [...ACTIVE_MATCH_STATUSES])))
    return rows.map((r) => r.steamId)
  }

  async ticketForParty(partyId: string): Promise<LiveTicket | null> {
    const id = await this.redis.get(K.party(partyId))
    return id ? this.ticket(id) : null
  }

  async ticket(id: string): Promise<LiveTicket | null> {
    const raw = await this.redis.get(K.ticket(id))
    return raw ? (JSON.parse(raw) as LiveTicket) : null
  }

  // Any member may pull the party out. Without modes the party leaves every queue
  async leave(steamId: string, modes?: Mode[]): Promise<void> {
    const party = await this.parties.partyOf(steamId)
    const ticket = party ? await this.ticketForParty(party.partyId) : null
    if (!party || !ticket) {
      await this.notifyParty([steamId])
      return
    }
    const remaining = modes ? ticket.modes.filter((m) => !modes.includes(m)) : []
    if (remaining.length === 0) {
      await this.cancelParty(party.partyId, "left")
      return
    }
    const next: LiveTicket = { ...ticket, modes: remaining }
    await this.db
      .update(queueTickets)
      .set({ modes: remaining, updatedAt: new Date(this.now()) })
      .where(eq(queueTickets.id, ticket.id))
    await this.putLive(next, ticket.modes)
    await this.notifyParty(ticket.steamIds)
  }

  async cancelParty(partyId: string, reason: string): Promise<void> {
    const ticket = await this.ticketForParty(partyId)
    if (!ticket) return
    await this.dropLive(ticket)
    await this.db
      .update(queueTickets)
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date(this.now()) })
      .where(and(eq(queueTickets.id, ticket.id), eq(queueTickets.status, "waiting")))
    await this.notifyParty(ticket.steamIds)
  }

  async waiting(mode: Mode): Promise<LiveTicket[]> {
    return this.loadTickets(await this.redis.zrange(K.queue(mode), 0, -1))
  }

  private async loadTickets(ids: string[]): Promise<LiveTicket[]> {
    const out: LiveTicket[] = []
    for (let i = 0; i < ids.length; i += MGET_CHUNK) {
      const raws = await this.redis.mget(...ids.slice(i, i + MGET_CHUNK).map(K.ticket))
      for (const r of raws) if (r) out.push(JSON.parse(r) as LiveTicket)
    }
    return out
  }

  // Consumes tickets for a match. The waiting to matched transition in Postgres is the arbiter,
  // so a ticket found by two modes at once only goes to one of them.
  async claim(ticketIds: string[], matchId: string, mode: Mode): Promise<ClaimResult> {
    let lost: string[] = []
    try {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(queueTickets)
          .set({ status: "matched", matchId, matchedMode: mode, updatedAt: new Date(this.now()) })
          .where(and(inArray(queueTickets.id, ticketIds), eq(queueTickets.status, "waiting")))
          .returning({ id: queueTickets.id })
        if (updated.length !== ticketIds.length) {
          const got = new Set(updated.map((u) => u.id))
          lost = ticketIds.filter((id) => !got.has(id))
          throw new ClaimLost()
        }
      })
    } catch (err) {
      if (err instanceof ClaimLost) {
        for (const id of lost) {
          const t = await this.ticket(id)
          if (t) await this.dropLive(t)
        }
        return { ok: false, lost }
      }
      throw err
    }
    for (const t of await this.loadTickets(ticketIds)) await this.dropLive(t)
    return { ok: true }
  }

  // Puts a ticket back with its original queue time and modes so the players keep their place
  async requeue(ticketId: string): Promise<void> {
    const [row] = await this.db.select().from(queueTickets).where(eq(queueTickets.id, ticketId))
    if (!row) return
    const party = await this.parties.get(row.partyId)
    const same =
      !!party &&
      party.memberSteamIds.length === row.steamIds.length &&
      row.steamIds.every((id) => party.memberSteamIds.includes(id))
    if (!same || (await this.redis.get(K.party(row.partyId)))) {
      await this.cancelTicket(ticketId, "party_changed")
      await this.notifyParty(row.steamIds)
      return
    }
    const ticket: LiveTicket = {
      id: row.id,
      partyId: row.partyId,
      modes: row.modes,
      steamIds: row.steamIds,
      ratings: row.ratings,
      region: row.region,
      enqueuedAt: row.enqueuedAt.getTime(),
    }
    try {
      await this.db
        .update(queueTickets)
        .set({ status: "waiting", matchId: null, matchedMode: null, updatedAt: new Date(this.now()) })
        .where(eq(queueTickets.id, ticketId))
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // The party queued again meanwhile
      await this.cancelTicket(ticketId, "party_changed")
      await this.notifyParty(row.steamIds)
      return
    }
    await this.putLive(ticket)
    await this.notifyParty(ticket.steamIds)
  }

  async cancelTicket(ticketId: string, reason: string, onlyWaiting = false): Promise<void> {
    const where = onlyWaiting ? and(eq(queueTickets.id, ticketId), eq(queueTickets.status, "waiting")) : eq(queueTickets.id, ticketId)
    await this.db
      .update(queueTickets)
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date(this.now()) })
      .where(where)
  }

  async playersInQueue(mode: Mode): Promise<number> {
    return (await this.sizes())[mode]
  }

  private async sizes(): Promise<Record<Mode, number>> {
    const raws = await this.redis.mget(...MODES.map(K.size))
    return Object.fromEntries(MODES.map((m, i) => [m, Math.max(0, Number(raws[i] ?? 0))])) as Record<Mode, number>
  }

  // Cached in Redis for a couple of seconds so every instance and every status call share one computation
  async aggregate(): Promise<QueueAggregate> {
    if (!this.aggregateStale) {
      const raw = await this.redis.get(K.aggregate)
      if (raw) return JSON.parse(raw) as QueueAggregate
    }
    return this.computeAggregate()
  }

  private computeAggregate(players?: Record<Mode, number>): Promise<QueueAggregate> {
    // Concurrent misses in one process share one computation
    if (this.aggregateInFlight && !players) return this.aggregateInFlight
    const run = (async () => {
      const sizes = players ?? (await this.sizes())
      const rows = await this.db
        .select({ mode: matches.mode, n: sql<number>`count(*)::int` })
        .from(matches)
        .where(inArray(matches.status, [...IN_PROGRESS_STATUSES]))
        .groupBy(matches.mode)
      const modes = {} as Record<Mode, ModeAggregate>
      for (const mode of MODES) {
        modes[mode] = {
          playersInQueue: sizes[mode],
          estimatedSec: this.eta ? await this.eta(mode) : null,
          matchesInProgress: Number(rows.find((r) => r.mode === mode)?.n ?? 0),
        }
      }
      const agg: QueueAggregate = { at: this.now(), modes }
      await this.redis.set(K.aggregate, JSON.stringify(agg), "PX", AGGREGATE_TTL_MS)
      this.aggregateStale = false
      return agg
    })()
    this.aggregateInFlight = run
    return run.finally(() => {
      if (this.aggregateInFlight === run) this.aggregateInFlight = null
    })
  }

  // Everything but the ticket's own fields comes from the shared aggregate
  queuedPayload(ticket: LiveTicket, agg: QueueAggregate, now: number, sizes?: Record<Mode, number>): QueueStatusPayload {
    const waitSec = Math.max(0, (now - ticket.enqueuedAt) / 1000)
    const modes: QueueModeStatus[] = ticket.modes.map((mode) => ({
      mode,
      queuedAt: ticket.enqueuedAt,
      waitSec: Math.floor(waitSec),
      ratingWindow: maxRatingDiffAfter(waitSec),
      playersInQueue: sizes?.[mode] ?? agg.modes[mode]?.playersInQueue ?? 0,
      estimatedSec: agg.modes[mode]?.estimatedSec ?? null,
      matchesInProgress: agg.modes[mode]?.matchesInProgress ?? 0,
    }))
    return { state: "queued", partyId: ticket.partyId, modes, cooldownUntil: null }
  }

  async status(steamId: string): Promise<QueueStatusPayload> {
    const party = await this.parties.partyOf(steamId)
    const ticket = party ? await this.ticketForParty(party.partyId) : null
    if (ticket) {
      const [agg, sizes] = await Promise.all([this.aggregate(), this.sizes()])
      return this.queuedPayload(ticket, agg, this.now(), sizes)
    }
    const cd = (await this.cooldowns.active([steamId])).get(steamId)
    return {
      state: cd ? "cooldown" : "idle",
      partyId: party?.partyId ?? null,
      modes: [],
      cooldownUntil: cd?.endsAt ?? null,
    }
  }

  async notifyParty(steamIds: string[]): Promise<void> {
    for (const id of steamIds) toUsers(this.notifier, [id], "queue_status", await this.status(id))
    for (const h of this.playerHooks) await h(steamIds).catch(() => undefined)
  }

  // Periodic refresh so clients see the wait and window grow. One aggregate per pass,
  // one message per party, no Postgres work per ticket
  async refreshQueued(): Promise<RefreshResult> {
    const read = this.redis.pipeline()
    for (const mode of MODES) read.zrange(K.queue(mode), 0, -1)
    const res = (await read.exec()) ?? []
    const ids = new Set<string>()
    for (const [, v] of res) for (const id of (v as string[] | null) ?? []) ids.add(id)
    const tickets = await this.loadTickets([...ids])

    // Exact sizes from this snapshot also repair any drift in the counters
    const players = Object.fromEntries(MODES.map((m) => [m, 0])) as Record<Mode, number>
    for (const t of tickets) for (const m of t.modes) players[m] += t.steamIds.length
    const fix = this.redis.pipeline()
    for (const m of MODES) fix.set(K.size(m), String(players[m]))
    await fix.exec()

    const agg = await this.computeAggregate(players)
    const now = this.now()
    for (const t of tickets) {
      toUsers(this.notifier, t.steamIds, "queue_status", { ...this.queuedPayload(t, agg, now), refresh: true })
    }
    return { tickets: tickets.length, players: tickets.reduce((s, t) => s + t.steamIds.length, 0) }
  }
}

class ClaimLost extends Error {}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true
  }
  return false
}
