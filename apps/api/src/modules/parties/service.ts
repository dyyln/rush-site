import type { PartyUpdatePayload } from "@rushsite/shared"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { parties, partyMembers } from "../../db/schema.js"
import { randomToken } from "../../lib/hmac.js"
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import type { UsersService } from "../auth/users.js"
import { toUsers, type Notifier } from "../ws/hub.js"

// Largest team size across modes
export const MAX_PARTY_SIZE = 3

export type PartyInfo = { partyId: string; leaderSteamId: string; memberSteamIds: string[]; inviteToken: string }

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

  async get(partyId: string): Promise<PartyInfo | null> {
    const [p] = await this.db
      .select()
      .from(parties)
      .where(and(eq(parties.id, partyId), isNull(parties.disbandedAt)))
    if (!p) return null
    const members = await this.db
      .select({ steamId: partyMembers.steamId })
      .from(partyMembers)
      .where(eq(partyMembers.partyId, partyId))
      .orderBy(asc(partyMembers.joinedAt))
    return {
      partyId: p.id,
      leaderSteamId: p.leaderSteamId,
      memberSteamIds: members.map((m) => m.steamId),
      inviteToken: p.inviteToken,
    }
  }

  async partyOf(steamId: string): Promise<PartyInfo | null> {
    const [m] = await this.db
      .select({ partyId: partyMembers.partyId })
      .from(partyMembers)
      .where(eq(partyMembers.steamId, steamId))
    return m ? this.get(m.partyId) : null
  }

  // Returns the player's party, creating a solo one if needed
  async ensure(steamId: string): Promise<PartyInfo> {
    return (await this.partyOf(steamId)) ?? this.createFresh(steamId)
  }

  private async createFresh(steamId: string): Promise<PartyInfo> {
    const [p] = await this.db
      .insert(parties)
      .values({ leaderSteamId: steamId, inviteToken: randomToken(12) })
      .returning()
    await this.db.insert(partyMembers).values({ partyId: p!.id, steamId })
    const info = { partyId: p!.id, leaderSteamId: steamId, memberSteamIds: [steamId], inviteToken: p!.inviteToken }
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
    if (party.leaderSteamId !== steamId) throw forbidden("not_leader")
    const token = randomToken(12)
    await this.db.update(parties).set({ inviteToken: token }).where(eq(parties.id, party.partyId))
    const info = { ...party, inviteToken: token }
    await this.publish(info)
    return info
  }

  async join(steamId: string, token: string): Promise<PartyInfo> {
    const [target] = await this.db
      .select()
      .from(parties)
      .where(and(eq(parties.inviteToken, token), isNull(parties.disbandedAt)))
    if (!target) throw notFound("invite_not_found")
    const party = (await this.get(target.id))!
    if (party.memberSteamIds.includes(steamId)) return party
    if (party.memberSteamIds.length >= MAX_PARTY_SIZE) throw conflict("party_full")
    const current = await this.partyOf(steamId)
    if (current) await this.leave(steamId, { silentSelf: true })
    await this.db.insert(partyMembers).values({ partyId: party.partyId, steamId })
    await this.changed(party.partyId, "member_joined")
    const info = (await this.get(party.partyId))!
    await this.publish(info)
    return info
  }

  async leave(steamId: string, opts: { silentSelf?: boolean } = {}): Promise<void> {
    const party = await this.partyOf(steamId)
    if (!party) return
    await this.changed(party.partyId, "member_left")
    await this.db
      .delete(partyMembers)
      .where(and(eq(partyMembers.partyId, party.partyId), eq(partyMembers.steamId, steamId)))
    const rest = party.memberSteamIds.filter((m) => m !== steamId)
    if (rest.length === 0) {
      await this.db.update(parties).set({ disbandedAt: new Date() }).where(eq(parties.id, party.partyId))
    } else {
      if (party.leaderSteamId === steamId) {
        await this.db.update(parties).set({ leaderSteamId: rest[0]! }).where(eq(parties.id, party.partyId))
      }
      await this.publish((await this.get(party.partyId))!)
    }
    if (!opts.silentSelf) toUsers(this.notifier, [steamId], "party_update", emptyParty())
  }

  async setLeader(steamId: string, target: string): Promise<PartyInfo> {
    const party = await this.partyOf(steamId)
    if (!party) throw notFound("no_party")
    if (party.leaderSteamId !== steamId) throw forbidden("not_leader")
    if (!party.memberSteamIds.includes(target)) throw badRequest("not_member")
    await this.db.update(parties).set({ leaderSteamId: target }).where(eq(parties.id, party.partyId))
    const info = { ...party, leaderSteamId: target }
    await this.publish(info)
    return info
  }

  async kick(steamId: string, target: string): Promise<PartyInfo> {
    const party = await this.partyOf(steamId)
    if (!party) throw notFound("no_party")
    if (party.leaderSteamId !== steamId) throw forbidden("not_leader")
    if (target === steamId || !party.memberSteamIds.includes(target)) throw badRequest("not_member")
    await this.leave(target)
    return (await this.get(party.partyId))!
  }

  async payload(info: PartyInfo | null): Promise<PartyUpdatePayload> {
    if (!info) return emptyParty()
    const cards = await this.users.cards(info.memberSteamIds)
    return {
      partyId: info.partyId,
      leaderSteamId: info.leaderSteamId,
      members: info.memberSteamIds.map((id) => ({
        steamId: id,
        displayName: cards.get(id)?.displayName ?? id,
        avatarUrl: cards.get(id)?.avatarUrl ?? null,
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
