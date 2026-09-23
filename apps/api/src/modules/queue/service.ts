import {
  allowedModesForParty,
  maxRatingDiffAfter,
  unresolvedConfig,
  type Mode,
  type QueueModeStatus,
  type QueueStatusPayload,
} from "@rushsite/shared"
import { and, eq, inArray } from "drizzle-orm"
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
  count: (mode: Mode) => `q:n:${mode}`,
}

const COUNT_TTL_MS = 5000

export type QueueOptions = {
  // Lets modes with placeholder config queue anyway, for local testing
  allowUnresolvedModes?: boolean
}

export type ClaimResult = { ok: true } | { ok: false; lost: string[] }

export function toMmTicket(t: LiveTicket, mode: Mode): MmTicket {
  return { id: t.id, size: t.steamIds.length, rating: t.ratings[mode] ?? 1500, enqueuedAt: t.enqueuedAt, region: t.region }
}

export class QueueService {
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

  // Joins one or more modes. Joining again while queued adds modes and keeps the original queue time
  async join(steamId: string, modes: Mode[]): Promise<LiveTicket> {
    const wanted = [...new Set(modes)]
    if (wanted.length === 0) throw badRequest("no_modes")
    if (!this.opts.allowUnresolvedModes) {
      const blocked = wanted.filter((m) => unresolvedConfig(m).length > 0)
      if (blocked.length > 0) throw new ApiError(503, "mode_unavailable", `not configured yet: ${blocked.join(",")}`)
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
      await this.notifyParty(merged.steamIds)
      return merged
    }

    const enqueuedAt = this.now()
    const [row] = await this.db
      .insert(queueTickets)
      .values({
        partyId: party.partyId,
        modes: wanted,
        steamIds: party.memberSteamIds,
        ratings,
        enqueuedAt: new Date(enqueuedAt),
      })
      .returning({ id: queueTickets.id })
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
    await this.notifyParty(ticket.steamIds)
    return ticket
  }

  private async putLive(ticket: LiveTicket, previousModes: Mode[] = []): Promise<void> {
    const tx = this.redis.multi().set(K.ticket(ticket.id), JSON.stringify(ticket)).set(K.party(ticket.partyId), ticket.id)
    for (const m of new Set([...previousModes, ...ticket.modes])) tx.del(K.count(m))
    for (const m of previousModes) if (!ticket.modes.includes(m)) tx.zrem(K.queue(m), ticket.id)
    for (const m of ticket.modes) tx.zadd(K.queue(m), ticket.enqueuedAt, ticket.id)
    await tx.exec()
  }

  private async dropLive(ticket: LiveTicket): Promise<void> {
    const tx = this.redis.multi().del(K.ticket(ticket.id)).del(K.party(ticket.partyId))
    for (const m of ticket.modes) tx.zrem(K.queue(m), ticket.id).del(K.count(m))
    await tx.exec()
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
    const ids = await this.redis.zrange(K.queue(mode), 0, -1)
    if (ids.length === 0) return []
    const raws = await this.redis.mget(...ids.map(K.ticket))
    return raws.filter((r): r is string => !!r).map((r) => JSON.parse(r) as LiveTicket)
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
    for (const id of ticketIds) {
      const t = await this.ticket(id)
      if (t) await this.dropLive(t)
    }
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
    await this.db
      .update(queueTickets)
      .set({ status: "waiting", matchId: null, matchedMode: null, updatedAt: new Date(this.now()) })
      .where(eq(queueTickets.id, ticketId))
    await this.putLive(ticket)
    await this.notifyParty(ticket.steamIds)
  }

  async cancelTicket(ticketId: string, reason: string): Promise<void> {
    await this.db
      .update(queueTickets)
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date(this.now()) })
      .where(eq(queueTickets.id, ticketId))
  }

  // Cached for a few seconds. The matchmaker refreshes it every pass
  async playersInQueue(mode: Mode): Promise<number> {
    const cached = await this.redis.get(K.count(mode))
    if (cached !== null) return Number(cached)
    return this.refreshCount(mode, await this.waiting(mode))
  }

  async refreshCount(mode: Mode, tickets: LiveTicket[]): Promise<number> {
    const n = tickets.reduce((s, t) => s + t.steamIds.length, 0)
    await this.redis.set(K.count(mode), String(n), "PX", COUNT_TTL_MS)
    return n
  }

  async status(steamId: string): Promise<QueueStatusPayload> {
    const party = await this.parties.partyOf(steamId)
    const ticket = party ? await this.ticketForParty(party.partyId) : null
    if (ticket) {
      const waitSec = Math.max(0, (this.now() - ticket.enqueuedAt) / 1000)
      const modes: QueueModeStatus[] = []
      for (const mode of ticket.modes) {
        modes.push({
          mode,
          queuedAt: ticket.enqueuedAt,
          waitSec: Math.floor(waitSec),
          ratingWindow: maxRatingDiffAfter(waitSec),
          playersInQueue: await this.playersInQueue(mode),
        })
      }
      return { state: "queued", partyId: ticket.partyId, modes, cooldownUntil: null }
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
  }

  // Periodic refresh so clients see the wait and window grow
  async broadcastQueued(): Promise<void> {
    const seen = new Set<string>()
    for (const mode of ["aim1v1", "aim2v2", "rush3v3"] as Mode[]) {
      for (const t of await this.waiting(mode)) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        await this.notifyParty(t.steamIds)
      }
    }
  }
}

class ClaimLost extends Error {}
