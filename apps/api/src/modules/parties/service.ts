import type { PartyUpdatePayload } from "@rushsite/shared"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { ACTIVE_MATCH_STATUSES } from "@rushsite/shared"
import type { Db } from "../../db/client.js"
import { matches, matchPlayers, parties, partyMembers, trustLevels } from "../../db/schema.js"
import { randomToken } from "../../lib/hmac.js"
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import type { UsersService } from "../auth/users.js"
import { toUsers, type Notifier } from "../ws/hub.js"

// Largest team size across modes
export const MAX_PARTY_SIZE = 3

export type PartyInfo = { partyId: string; leaderSteamId: string; memberSteamIds: string[]; inviteToken: string }

export type InvitePreview = {
  partyId: string
  leader: { steamId: string; displayName: string; avatarUrl: string | null }
  size: number
  capacity: number
  full: boolean
  isMember: boolean
}

export type PartyChangeHook = (partyId: string, reason: string) => Promise<void>

export class PartyService {
  private hooks: PartyChangeHook[] = []

  constructor(
    private readonly db: Db,
    private readonly users: UsersService,
    private readonly notifier: Notifier,
  ) {}

  // Queue uses this to drop tickets when a party changes shape
  onChange(hook: PartyChangeHook): void {
    this.hooks.push(hook)
  }

  private async changed(partyId: string, reason: string): Promise<void> {
    for (const h of this.hooks) await h(partyId, reason)
  }

  async get(partyId: string, db: Db = this.db): Promise<PartyInfo | null> {
    const [p] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.id, partyId), isNull(parties.disbandedAt)))
    if (!p) return null
    const members = await db
      .select({ steamId: partyMembers.steamId })
      .from(partyMembers)
      .where(eq(partyMembers.partyId, partyId))
      .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.steamId))
    return {
      partyId: p.id,
      leaderSteamId: p.leaderSteamId,
      memberSteamIds: members.map((m) => m.steamId),
      inviteToken: p.inviteToken,
    }
  }

  private async partyIdOf(steamId: string, db: Db = this.db): Promise<string | null> {
    const [m] = await db
      .select({ partyId: partyMembers.partyId })
      .from(partyMembers)
      .where(eq(partyMembers.steamId, steamId))
    return m?.partyId ?? null
  }

  async partyOf(steamId: string): Promise<PartyInfo | null> {
    const id = await this.partyIdOf(steamId)
    return id ? this.get(id) : null
  }

  // Runs membership changes one at a time per party. Rows are locked in id order so two parties never deadlock
  private locked<T>(partyIds: string[], fn: (tx: Db) => Promise<T>): Promise<T> {
    const ids = [...new Set(partyIds)].sort()
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      await tx.select({ id: parties.id }).from(parties).where(inArray(parties.id, ids)).orderBy(asc(parties.id)).for("update")
      return fn(tx)
    })
  }

  // Refuses roster changes while any member is in an active match
  private async assertUnlocked(tx: Db, steamIds: string[]): Promise<void> {
    if (steamIds.length === 0) return
    const [busy] = await tx
      .select({ id: matches.id })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(inArray(matchPlayers.steamId, steamIds), inArray(matches.status, [...ACTIVE_MATCH_STATUSES])))
      .limit(1)
    if (busy) throw conflict("party_locked", "the party is in a match")
  }

  // Removes one member inside a locked transaction. Promotes the earliest joiner or disbands when empty
  private async removeMember(tx: Db, partyId: string, steamId: string): Promise<boolean> {
    const party = await this.get(partyId, tx)
    if (!party || !party.memberSteamIds.includes(steamId)) return false
    await tx.delete(partyMembers).where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.steamId, steamId)))
    const rest = party.memberSteamIds.filter((m) => m !== steamId)
    if (rest.length === 0) {
      await tx.update(parties).set({ disbandedAt: new Date() }).where(eq(parties.id, partyId))
    } else if (party.leaderSteamId === steamId) {
      await tx.update(parties).set({ leaderSteamId: rest[0]! }).where(eq(parties.id, partyId))
    }
    return true
  }

  // Tells the queue and the remaining members after a member left
  private async afterRemoval(partyId: string, steamId: string, reason: string, silentSelf: boolean): Promise<void> {
    await this.changed(partyId, reason)
    const rest = await this.get(partyId)
    if (rest) await this.publish(rest)
    if (!silentSelf) toUsers(this.notifier, [steamId], "party_update", emptyParty())
  }

  // Returns the player's party, creating a solo one if needed
  async ensure(steamId: string): Promise<PartyInfo> {
    return (await this.partyOf(steamId)) ?? this.createFresh(steamId)
  }

  private async createFresh(steamId: string): Promise<PartyInfo> {
    let info: PartyInfo
    try {
      info = await this.db.transaction(async (raw) => {
        const tx = raw as unknown as Db
        const [p] = await tx.insert(parties).values({ leaderSteamId: steamId, inviteToken: randomToken(12) }).returning()
        await tx.insert(partyMembers).values({ partyId: p!.id, steamId })
        return { partyId: p!.id, leaderSteamId: steamId, memberSteamIds: [steamId], inviteToken: p!.inviteToken }
      })
    } catch (err) {
      // A parallel request already put this player in a party
      const current = isUniqueViolation(err) ? await this.partyOf(steamId) : null
      if (!current) throw err
      return current
    }
    await this.publish(info)
    return info
  }

  // Leaves any party with other members and starts a new one
  async create(steamId: string): Promise<PartyInfo> {
    const current = await this.partyOf(steamId)
    if (current && current.memberSteamIds.length === 1) return current
    if (current) await this.leave(steamId, { silentSelf: true })
    return this.createFresh(steamId)
  }

  async rotateInvite(steamId: string): Promise<PartyInfo> {
    const party = await this.ensure(steamId)
    const info = await this.locked([party.partyId], async (tx) => {
      const fresh = await this.get(party.partyId, tx)
      if (!fresh || !fresh.memberSteamIds.includes(steamId)) throw conflict("party_changed")
      if (fresh.leaderSteamId !== steamId) throw forbidden("not_leader")
      const token = randomToken(12)
      await tx.update(parties).set({ inviteToken: token }).where(eq(parties.id, party.partyId))
      return { ...fresh, inviteToken: token }
    })
    await this.publish(info)
    return info
  }

  // Public view of an invite link so the invite page can say who invited and whether there is room
  async preview(token: string, viewer: string | null): Promise<InvitePreview> {
    const [target] = await this.db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.inviteToken, token), isNull(parties.disbandedAt)))
    const party = target ? await this.get(target.id) : null
    if (!party) throw notFound("invite_not_found")
    const card = (await this.users.cards([party.leaderSteamId])).get(party.leaderSteamId)
    return {
      partyId: party.partyId,
      leader: { steamId: party.leaderSteamId, displayName: card?.displayName ?? party.leaderSteamId, avatarUrl: card?.avatarUrl ?? null },
      size: party.memberSteamIds.length,
      capacity: MAX_PARTY_SIZE,
      full: party.memberSteamIds.length >= MAX_PARTY_SIZE,
      isMember: !!viewer && party.memberSteamIds.includes(viewer),
    }
  }

  async join(steamId: string, token: string): Promise<PartyInfo> {
    const [target] = await this.db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.inviteToken, token), isNull(parties.disbandedAt)))
    if (!target) throw notFound("invite_not_found")
    const currentId = await this.partyIdOf(steamId)
    if (currentId === target.id) return (await this.get(target.id))!
    let moved: { from: string | null; party: PartyInfo }
    try {
      moved = await this.locked(currentId ? [target.id, currentId] : [target.id], async (tx) => {
        // Re-read under the lock. The code may have rotated or the party filled up meanwhile
        const party = await this.get(target.id, tx)
        if (!party || party.inviteToken !== token) throw notFound("invite_not_found")
        if (party.memberSteamIds.includes(steamId)) return { from: null, party }
        if (party.memberSteamIds.length >= MAX_PARTY_SIZE) throw conflict("party_full")
        if ((await this.partyIdOf(steamId, tx)) !== currentId) throw conflict("party_changed")
        await this.assertUnlocked(tx, [...party.memberSteamIds, steamId])
        if (currentId) await this.assertUnlocked(tx, (await this.get(currentId, tx))?.memberSteamIds ?? [])
        if (currentId) await this.removeMember(tx, currentId, steamId)
        await tx.insert(partyMembers).values({ partyId: party.partyId, steamId })
        return { from: currentId, party: (await this.get(party.partyId, tx))! }
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("party_changed")
      throw err
    }
    if (moved.from) await this.afterRemoval(moved.from, steamId, "member_left", true)
    await this.changed(moved.party.partyId, "member_joined")
    await this.publish(moved.party)
    return moved.party
  }

  async leave(steamId: string, opts: { silentSelf?: boolean } = {}): Promise<void> {
    const partyId = await this.partyIdOf(steamId)
    if (!partyId) {
      if (!opts.silentSelf) toUsers(this.notifier, [steamId], "party_update", emptyParty())
      return
    }
    const removed = await this.locked([partyId], async (tx) => {
      await this.assertUnlocked(tx, (await this.get(partyId, tx))?.memberSteamIds ?? [])
      return this.removeMember(tx, partyId, steamId)
    })
    // Someone else moved this player first. Their change already notified everyone
    if (!removed) return
    await this.afterRemoval(partyId, steamId, "member_left", !!opts.silentSelf)
  }

  async setLeader(steamId: string, target: string): Promise<PartyInfo> {
    const partyId = await this.partyIdOf(steamId)
    if (!partyId) throw notFound("no_party")
    const info = await this.locked([partyId], async (tx) => {
      const party = await this.get(partyId, tx)
      if (!party || !party.memberSteamIds.includes(steamId)) throw conflict("party_changed")
      if (party.leaderSteamId !== steamId) throw forbidden("not_leader")
      if (!party.memberSteamIds.includes(target)) throw badRequest("not_member")
      await tx.update(parties).set({ leaderSteamId: target }).where(eq(parties.id, partyId))
      return { ...party, leaderSteamId: target }
    })
    await this.publish(info)
    return info
  }

  async kick(steamId: string, target: string): Promise<PartyInfo> {
    const partyId = await this.partyIdOf(steamId)
    if (!partyId) throw notFound("no_party")
    await this.locked([partyId], async (tx) => {
      const party = await this.get(partyId, tx)
      if (!party || !party.memberSteamIds.includes(steamId)) throw conflict("party_changed")
      if (party.leaderSteamId !== steamId) throw forbidden("not_leader")
      if (target === steamId || !party.memberSteamIds.includes(target)) throw badRequest("not_member")
      await this.assertUnlocked(tx, party.memberSteamIds)
      await this.removeMember(tx, partyId, target)
      // The kicked player must not be able to walk back in with the old link
      await tx.update(parties).set({ inviteToken: randomToken(12) }).where(eq(parties.id, partyId))
    })
    await this.afterRemoval(partyId, target, "member_kicked", false)
    return (await this.get(partyId))!
  }

  async payload(info: PartyInfo | null): Promise<PartyUpdatePayload> {
    if (!info) return emptyParty()
    const cards = await this.users.cards(info.memberSteamIds)
    const trust = new Map(
      (
        await this.db
          .select({ steamId: trustLevels.steamId, level: trustLevels.level })
          .from(trustLevels)
          .where(inArray(trustLevels.steamId, info.memberSteamIds))
      ).map((r) => [r.steamId, r.level]),
    )
    return {
      partyId: info.partyId,
      leaderSteamId: info.leaderSteamId,
      members: info.memberSteamIds.map((id) => ({
        steamId: id,
        displayName: cards.get(id)?.displayName ?? id,
        avatarUrl: cards.get(id)?.avatarUrl ?? null,
        trustLevel: trust.get(id) ?? "new",
      })),
      inviteCode: info.inviteToken,
    }
  }

  async publish(info: PartyInfo): Promise<void> {
    toUsers(this.notifier, info.memberSteamIds, "party_update", await this.payload(info))
  }
}

export function emptyParty(): PartyUpdatePayload {
  return { partyId: null, leaderSteamId: null, members: [], inviteCode: null }
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true
  }
  return false
}
