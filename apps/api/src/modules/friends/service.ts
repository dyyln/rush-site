import {
  MODES,
  PARTY_INVITE_TTL_SEC,
  tierForRating,
  type Friend,
  type FriendCard,
  type FriendRequest,
  type FriendsPendingResponse,
  type FriendsResponse,
  type FriendTier,
  type FriendUpdatePayload,
  type Mode,
  type PartyInvite,
  type PartyInvitePayload,
  type PartyUpdatePayload,
  type Presence,
  type PresenceDetail,
  type RecentPlayer,
  type SteamOnlyFriend,
} from "@rushsite/shared"
import { and, desc, eq, gt, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm"
import type { AppContext } from "../../context.js"
import { matchPlayers, matches, ratings, users } from "../../db/schema.js"
import { ApiError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import { MAX_PARTY_SIZE } from "../parties/service.js"
import { toUsers } from "../ws/hub.js"
import { friendRequests, friendships, partyInvites } from "./schema.js"

type RequestRow = typeof friendRequests.$inferSelect
type InviteRow = typeof partyInvites.$inferSelect

export const MAX_OUTGOING_REQUESTS = 50
const RECENT_MATCHES = 20
const STEAM_CACHE_SEC = 300
const steamCacheKey = (steamId: string) => `friends:steam:${steamId}`

const PRESENCE_ORDER: Record<Presence, number> = { match: 0, queue: 1, online: 2, offline: 3 }

export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

type SteamCache = { available: boolean; steamOnly: SteamOnlyFriend[] }

type Deps = Pick<AppContext, "db" | "redis" | "notifier" | "steam" | "users" | "parties" | "log" | "now"> & {
  presence: { get(ids: string[]): Promise<Map<string, { state: Presence; detail?: PresenceDetail }>> }
}

export class FriendsService {
  constructor(private readonly d: Deps) {}

  private date(): Date {
    return new Date(this.d.now())
  }

  private async cardMap(ids: string[]): Promise<(id: string) => FriendCard> {
    const cards = await this.d.users.cards([...new Set(ids)])
    return (id) => ({ steamId: id, displayName: cards.get(id)?.displayName ?? id, avatarUrl: cards.get(id)?.avatarUrl ?? null })
  }

  async requestViews(rows: RequestRow[]): Promise<FriendRequest[]> {
    const card = await this.cardMap(rows.flatMap((r) => [r.fromSteamId, r.toSteamId]))
    return rows.map((r) => ({
      id: r.id,
      from: card(r.fromSteamId),
      to: card(r.toSteamId),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
    }))
  }

  async inviteViews(rows: InviteRow[]): Promise<PartyInvite[]> {
    const card = await this.cardMap(rows.map((r) => r.fromSteamId))
    return rows.map((r) => ({
      id: r.id,
      partyId: r.partyId,
      from: card(r.fromSteamId),
      inviteCode: r.inviteCode,
      expiresAt: r.expiresAt.toISOString(),
      status: r.status,
    }))
  }

  // Sends friend_update to both sides, each seeing the other player's id
  private notifyPair(a: string, b: string, kind: FriendUpdatePayload["kind"], request?: FriendRequest): void {
    for (const [to, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const payload: FriendUpdatePayload = { kind, steamId: other, ...(request ? { request } : {}) }
      toUsers(this.d.notifier, [to], "friend_update", payload)
    }
  }

  async friendIds(steamId: string): Promise<string[]> {
    const rows = await this.d.db
      .select({ a: friendships.userA, b: friendships.userB })
      .from(friendships)
      .where(and(eq(friendships.status, "accepted"), or(eq(friendships.userA, steamId), eq(friendships.userB, steamId))))
    return rows.map((r) => (r.a === steamId ? r.b : r.a))
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const [x, y] = orderedPair(a, b)
    const [row] = await this.d.db
      .select({ s: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.userA, x), eq(friendships.userB, y), eq(friendships.status, "accepted")))
    return !!row
  }

  // Links every registered Steam friend. Never removes anything and skips pairs someone unfriended
  async syncSteam(steamId: string): Promise<{ available: boolean; linked: string[] }> {
    if (!this.d.steam.enabled) {
      await this.cacheSteam(steamId, { available: false, steamOnly: [] })
      return { available: false, linked: [] }
    }
    const list = await this.d.steam.friendList(steamId)
    if (list === null) {
      await this.cacheSteam(steamId, { available: false, steamOnly: [] })
      return { available: false, linked: [] }
    }
    const ids = [...new Set(list.map((f) => f.steamid))].filter((id) => id !== steamId)
    const registered = ids.length
      ? (await this.d.db.select({ id: users.steamId }).from(users).where(inArray(users.steamId, ids))).map((r) => r.id)
      : []
    const linked: string[] = []
    if (registered.length > 0) {
      const rows = registered.map((other) => {
        const [userA, userB] = orderedPair(steamId, other)
        return { userA, userB, source: "steam" as const, status: "accepted" as const }
      })
      const inserted = await this.d.db
        .insert(friendships)
        .values(rows)
        .onConflictDoNothing()
        .returning({ a: friendships.userA, b: friendships.userB })
      for (const r of inserted) {
        const other = r.a === steamId ? r.b : r.a
        linked.push(other)
        await this.settleRequests(steamId, other)
        this.notifyPair(steamId, other, "accepted")
      }
    }
    const unregistered = ids.filter((id) => !registered.includes(id))
    let steamOnly: SteamOnlyFriend[] = []
    if (unregistered.length > 0) {
      const summaries = await this.d.steam.playerSummaries(unregistered)
      steamOnly = summaries.map((s) => ({
        steamId: s.steamid,
        displayName: s.personaname ?? s.steamid,
        avatarUrl: s.avatarmedium ?? s.avatar ?? null,
        personaState: (s as { personastate?: number }).personastate ?? 0,
      }))
      steamOnly.sort((a, b) => Number(b.personaState > 0) - Number(a.personaState > 0) || a.displayName.localeCompare(b.displayName))
    }
    await this.cacheSteam(steamId, { available: true, steamOnly })
    return { available: true, linked }
  }

  private async cacheSteam(steamId: string, value: SteamCache): Promise<void> {
    await this.d.redis.set(steamCacheKey(steamId), JSON.stringify(value), "EX", STEAM_CACHE_SEC)
  }

  private async steamList(steamId: string): Promise<SteamCache> {
    const raw = await this.d.redis.get(steamCacheKey(steamId))
    if (raw) return JSON.parse(raw) as SteamCache
    try {
      await this.syncSteam(steamId)
    } catch (err) {
      this.d.log.warn({ err, steamId }, "steam friends sync failed")
      return { available: false, steamOnly: [] }
    }
    const again = await this.d.redis.get(steamCacheKey(steamId))
    return again ? (JSON.parse(again) as SteamCache) : { available: false, steamOnly: [] }
  }

  // Closes pending requests in either direction once two players are friends
  private async settleRequests(a: string, b: string): Promise<void> {
    await this.d.db
      .update(friendRequests)
      .set({ status: "accepted", respondedAt: this.date() })
      .where(
        and(
          eq(friendRequests.status, "pending"),
          or(
            and(eq(friendRequests.fromSteamId, a), eq(friendRequests.toSteamId, b)),
            and(eq(friendRequests.fromSteamId, b), eq(friendRequests.toSteamId, a)),
          ),
        ),
      )
  }

  private async tiers(ids: string[]): Promise<Map<string, Record<Mode, FriendTier>>> {
    const out = new Map<string, Record<Mode, FriendTier>>()
    for (const id of ids) out.set(id, Object.fromEntries(MODES.map((m) => [m, "unranked"])) as Record<Mode, FriendTier>)
    if (ids.length === 0) return out
    const rows = await this.d.db
      .select({ steamId: ratings.steamId, mode: ratings.mode, rating: ratings.rating, played: ratings.matchesPlayed })
      .from(ratings)
      .where(inArray(ratings.steamId, ids))
    for (const r of rows) if (r.played > 0) out.get(r.steamId)![r.mode] = tierForRating(r.rating).id
    return out
  }

  async list(steamId: string): Promise<FriendsResponse> {
    const steam = await this.steamList(steamId)
    const rows = await this.d.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.status, "accepted"), or(eq(friendships.userA, steamId), eq(friendships.userB, steamId))))
    const ids = rows.map((r) => (r.userA === steamId ? r.userB : r.userA))
    const [card, presence, tiers] = await Promise.all([this.cardMap(ids), this.d.presence.get(ids), this.tiers(ids)])
    const friends: Friend[] = rows.map((r) => {
      const id = r.userA === steamId ? r.userB : r.userA
      const p = presence.get(id)
      return {
        ...card(id),
        presence: p?.state ?? "offline",
        ...(p?.detail ? { detail: p.detail } : {}),
        source: r.source,
        tiers: tiers.get(id)!,
      }
    })
    friends.sort(
      (a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] || a.displayName.localeCompare(b.displayName),
    )
    const pending = await this.d.db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          or(eq(friendRequests.toSteamId, steamId), eq(friendRequests.fromSteamId, steamId)),
        ),
      )
      .orderBy(desc(friendRequests.createdAt))
    const views = await this.requestViews(pending)
    return {
      friends,
      incoming: views.filter((v) => v.to.steamId === steamId),
      outgoing: views.filter((v) => v.from.steamId === steamId),
      steamListAvailable: steam.available,
      steamOnly: steam.steamOnly,
    }
  }

  async pending(steamId: string): Promise<FriendsPendingResponse> {
    const [count] = await this.d.db
      .select({ n: sql<number>`count(*)::int` })
      .from(friendRequests)
      .where(and(eq(friendRequests.toSteamId, steamId), eq(friendRequests.status, "pending")))
    const invites = await this.d.db
      .select()
      .from(partyInvites)
      .where(and(eq(partyInvites.toSteamId, steamId), eq(partyInvites.status, "pending"), gt(partyInvites.expiresAt, this.date())))
      .orderBy(desc(partyInvites.createdAt))
    return { requests: Number(count?.n ?? 0), invites: await this.inviteViews(invites) }
  }

  private async loadRequest(id: string): Promise<RequestRow> {
    const [row] = await this.d.db.select().from(friendRequests).where(eq(friendRequests.id, id))
    if (!row) throw notFound("request_not_found")
    return row
  }

  // Sending to someone who already asked you accepts their request
  async sendRequest(from: string, to: string): Promise<{ request: FriendRequest; created: boolean }> {
    if (from === to) throw badRequest("cannot_add_self")
    if (!(await this.d.users.card(to))) throw notFound("user_not_found")
    if (await this.areFriends(from, to)) throw conflict("already_friends")
    const [reverse] = await this.d.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.fromSteamId, to), eq(friendRequests.toSteamId, from), eq(friendRequests.status, "pending")))
    if (reverse) return { request: await this.accept(from, reverse.id), created: false }
    const [existing] = await this.d.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.fromSteamId, from), eq(friendRequests.toSteamId, to), eq(friendRequests.status, "pending")))
    if (existing) return { request: (await this.requestViews([existing]))[0]!, created: false }
    const [count] = await this.d.db
      .select({ n: sql<number>`count(*)::int` })
      .from(friendRequests)
      .where(and(eq(friendRequests.fromSteamId, from), eq(friendRequests.status, "pending")))
    if (Number(count?.n ?? 0) >= MAX_OUTGOING_REQUESTS) throw new ApiError(429, "too_many_requests")
    const [row] = await this.d.db
      .insert(friendRequests)
      .values({ fromSteamId: from, toSteamId: to, createdAt: this.date() })
      .onConflictDoNothing()
      .returning()
    if (!row) return { request: (await this.requestViews([(await this.pendingBetween(from, to))!]))[0]!, created: false }
    const request = (await this.requestViews([row]))[0]!
    this.notifyPair(from, to, "request", request)
    return { request, created: true }
  }

  private async pendingBetween(from: string, to: string): Promise<RequestRow | undefined> {
    const [row] = await this.d.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.fromSteamId, from), eq(friendRequests.toSteamId, to), eq(friendRequests.status, "pending")))
    return row
  }

  private async respond(row: RequestRow, status: "accepted" | "declined" | "cancelled"): Promise<RequestRow> {
    const [next] = await this.d.db
      .update(friendRequests)
      .set({ status, respondedAt: this.date() })
      .where(and(eq(friendRequests.id, row.id), eq(friendRequests.status, "pending")))
      .returning()
    if (!next) throw conflict("request_not_pending")
    return next
  }

  async accept(steamId: string, id: string): Promise<FriendRequest> {
    const row = await this.loadRequest(id)
    if (row.toSteamId !== steamId) throw forbidden("not_recipient")
    const next = await this.respond(row, "accepted")
    const [userA, userB] = orderedPair(row.fromSteamId, row.toSteamId)
    await this.d.db
      .insert(friendships)
      .values({ userA, userB, source: "request", status: "accepted" })
      .onConflictDoUpdate({
        target: [friendships.userA, friendships.userB],
        set: { status: "accepted", source: "request", updatedAt: this.date() },
      })
    const request = (await this.requestViews([next]))[0]!
    this.notifyPair(row.fromSteamId, row.toSteamId, "accepted", request)
    return request
  }

  async decline(steamId: string, id: string): Promise<FriendRequest> {
    const row = await this.loadRequest(id)
    if (row.toSteamId !== steamId) throw forbidden("not_recipient")
    const request = (await this.requestViews([await this.respond(row, "declined")]))[0]!
    this.notifyPair(row.fromSteamId, row.toSteamId, "declined", request)
    return request
  }

  // Withdrawn by the sender. Both sides get a declined update carrying status cancelled
  async cancel(steamId: string, id: string): Promise<FriendRequest> {
    const row = await this.loadRequest(id)
    if (row.fromSteamId !== steamId) throw forbidden("not_sender")
    const request = (await this.requestViews([await this.respond(row, "cancelled")]))[0]!
    this.notifyPair(row.fromSteamId, row.toSteamId, "declined", request)
    return request
  }

  async unfriend(steamId: string, other: string): Promise<void> {
    const [userA, userB] = orderedPair(steamId, other)
    const done = await this.d.db
      .update(friendships)
      .set({ status: "removed", updatedAt: this.date() })
      .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB), eq(friendships.status, "accepted")))
      .returning({ a: friendships.userA })
    if (done.length === 0) throw notFound("not_friends")
    this.notifyPair(steamId, other, "removed")
  }

  // Players from the viewer's last matches who are not friends yet, most recent first
  async recent(steamId: string): Promise<RecentPlayer[]> {
    const mine = await this.d.db
      .select({ matchId: matches.id, mode: matches.mode, at: matches.createdAt })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), notInArray(matches.status, ["accepting", "cancelled"])))
      .orderBy(desc(matches.createdAt))
      .limit(RECENT_MATCHES)
    if (mine.length === 0) return []
    const others = await this.d.db
      .select({ matchId: matchPlayers.matchId, steamId: matchPlayers.steamId })
      .from(matchPlayers)
      .where(and(inArray(matchPlayers.matchId, mine.map((m) => m.matchId)), ne(matchPlayers.steamId, steamId)))
    const friends = new Set(await this.friendIds(steamId))
    const order = new Map(mine.map((m, i) => [m.matchId, i]))
    const best = new Map<string, (typeof mine)[number]>()
    for (const o of others) {
      if (friends.has(o.steamId)) continue
      const m = mine[order.get(o.matchId)!]!
      const cur = best.get(o.steamId)
      if (!cur || order.get(m.matchId)! < order.get(cur.matchId)!) best.set(o.steamId, m)
    }
    const ids = [...best.keys()]
    if (ids.length === 0) return []
    const outgoing = await this.d.db
      .select({ to: friendRequests.toSteamId })
      .from(friendRequests)
      .where(and(eq(friendRequests.fromSteamId, steamId), eq(friendRequests.status, "pending"), inArray(friendRequests.toSteamId, ids)))
    const requested = new Set(outgoing.map((r) => r.to))
    const card = await this.cardMap(ids)
    return ids
      .map((id) => {
        const m = best.get(id)!
        return { ...card(id), matchId: m.matchId, mode: m.mode, playedAt: m.at.toISOString(), requested: requested.has(id) }
      })
      .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
  }

  // In-site invite to a friend. Creates a solo party for the sender when needed
  async invite(from: string, to: string): Promise<{ invite: PartyInvite; party: PartyUpdatePayload }> {
    if (from === to) throw badRequest("cannot_invite_self")
    if (!(await this.areFriends(from, to))) throw forbidden("not_friends")
    const party = await this.d.parties.ensure(from)
    if (party.memberSteamIds.includes(to)) throw conflict("already_in_party")
    if (party.memberSteamIds.length >= MAX_PARTY_SIZE) throw conflict("party_full")
    const expiresAt = new Date(this.d.now() + PARTY_INVITE_TTL_SEC * 1000)
    const [existing] = await this.d.db
      .select()
      .from(partyInvites)
      .where(and(eq(partyInvites.partyId, party.partyId), eq(partyInvites.toSteamId, to), eq(partyInvites.status, "pending")))
    let row: InviteRow
    if (existing) {
      const [next] = await this.d.db
        .update(partyInvites)
        .set({ expiresAt, fromSteamId: from, inviteCode: party.inviteToken })
        .where(eq(partyInvites.id, existing.id))
        .returning()
      row = next!
    } else {
      const [next] = await this.d.db
        .insert(partyInvites)
        .values({ partyId: party.partyId, fromSteamId: from, toSteamId: to, inviteCode: party.inviteToken, expiresAt, createdAt: this.date() })
        .returning()
      row = next!
    }
    const invite = (await this.inviteViews([row]))[0]!
    const payload: PartyInvitePayload = { invite }
    toUsers(this.d.notifier, [to], "party_invite", payload)
    return { invite, party: await this.d.parties.payload(party) }
  }

  private async loadInvite(steamId: string, id: string): Promise<InviteRow> {
    const [row] = await this.d.db.select().from(partyInvites).where(eq(partyInvites.id, id))
    if (!row || row.toSteamId !== steamId) throw notFound("invite_not_found")
    if (row.status !== "pending") throw conflict("invite_not_pending")
    if (row.expiresAt.getTime() <= this.d.now()) {
      await this.closeInvite(row, "expired")
      throw new ApiError(410, "invite_expired")
    }
    return row
  }

  private async closeInvite(row: InviteRow, status: "accepted" | "declined" | "expired"): Promise<PartyInvite> {
    const [next] = await this.d.db
      .update(partyInvites)
      .set({ status, respondedAt: this.date() })
      .where(and(eq(partyInvites.id, row.id), eq(partyInvites.status, "pending")))
      .returning()
    const invite = (await this.inviteViews([next ?? { ...row, status }]))[0]!
    // Lets the target's other tabs drop the toast
    toUsers(this.d.notifier, [row.toSteamId], "party_invite", { invite } satisfies PartyInvitePayload)
    return invite
  }

  // Joins through the same invite code path as a shared link. A rotated code falls back to the party's current one
  async acceptInvite(steamId: string, id: string): Promise<{ invite: PartyInvite; party: PartyUpdatePayload }> {
    const row = await this.loadInvite(steamId, id)
    const party = await this.d.parties.get(row.partyId)
    if (!party) {
      await this.closeInvite(row, "expired")
      throw new ApiError(410, "party_gone")
    }
    let joined
    try {
      joined = await this.d.parties.join(steamId, row.inviteCode)
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "invite_not_found") throw err
      joined = await this.d.parties.join(steamId, party.inviteToken)
    }
    const invite = await this.closeInvite(row, "accepted")
    return { invite, party: await this.d.parties.payload(joined) }
  }

  async declineInvite(steamId: string, id: string): Promise<PartyInvite> {
    const row = await this.loadInvite(steamId, id)
    return this.closeInvite(row, "declined")
  }

  async expireInvites(): Promise<number> {
    const rows = await this.d.db
      .update(partyInvites)
      .set({ status: "expired", respondedAt: this.date() })
      .where(and(eq(partyInvites.status, "pending"), lte(partyInvites.expiresAt, this.date())))
      .returning()
    for (const view of await this.inviteViews(rows)) {
      const to = rows.find((r) => r.id === view.id)!.toSteamId
      toUsers(this.d.notifier, [to], "party_invite", { invite: view } satisfies PartyInvitePayload)
    }
    return rows.length
  }
}
