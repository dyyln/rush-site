import type { FriendRequest, FriendsResponse, PartyInvite } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers, steamId as newSteamId } from "../../../test/helpers.js"
import { partyInvites } from "../../db/schema.js"
import { orderedPair } from "./service.js"

type H = Awaited<ReturnType<typeof createAppHarness>>

// Minimal Steam Web API double. friendLists maps a steam id to its friend ids, null is a private profile
function steamFetch(friendLists: Map<string, string[] | null>): typeof fetch {
  return (async (input: string | URL) => {
    const url = new URL(String(input))
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    if (url.pathname.includes("GetFriendList")) {
      const list = friendLists.get(url.searchParams.get("steamid") ?? "")
      if (list === null || list === undefined) return json({}, 401)
      return json({ friendslist: { friends: list.map((id) => ({ steamid: id, relationship: "friend", friend_since: 1 })) } })
    }
    if (url.pathname.includes("GetPlayerSummaries")) {
      const ids = (url.searchParams.get("steamids") ?? "").split(",")
      return json({ response: { players: ids.map((id) => ({ steamid: id, personaname: `steam-${id.slice(-4)}`, personastate: 1 })) } })
    }
    return json({}, 404)
  }) as unknown as typeof fetch
}

describe("friends", () => {
  let h: H
  const lists = new Map<string, string[] | null>()

  beforeEach(async () => {
    lists.clear()
    h = await createAppHarness({ env: { STEAM_API_KEY: "test-key" }, fetch: steamFetch(lists) })
  })
  afterEach(async () => {
    await h.close()
  })

  const cookie = async (id: string) => ({ rs_sid: h.app.signCookie(await h.ctx.sessions.create(id)) })
  async function call(as: string | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) {
    const res = await h.app.inject({ method, url, ...(as ? { cookies: await cookie(as) } : {}), ...(payload ? { payload } : {}) })
    return { status: res.statusCode, body: (res.body ? res.json() : {}) as Record<string, unknown> }
  }
  const friendsOf = async (id: string) => (await call(id, "GET", "/friends")).body as unknown as FriendsResponse

  it("requires a session", async () => {
    expect((await call(null, "GET", "/friends")).status).toBe(401)
    expect((await call(null, "POST", "/friends/requests", { steamId: newSteamId() })).status).toBe(401)
  })

  it("auto-links registered Steam friends and lists the rest for Send link", async () => {
    const [me, reg1, reg2] = await makeUsers(h.db, 3)
    const outsider = newSteamId()
    lists.set(me!, [reg1!, reg2!, outsider])
    const r = await call(me!, "POST", "/friends/sync")
    expect(r.body).toEqual({ steamListAvailable: true, linked: 2 })
    expect(h.notifier.ofType("friend_update").filter((m) => (m.msg.payload as { kind: string }).kind === "accepted")).toHaveLength(4)

    const list = await friendsOf(me!)
    expect(list.steamListAvailable).toBe(true)
    expect(list.friends.map((f) => f.steamId).sort()).toEqual([reg1, reg2].sort())
    expect(list.friends[0]).toMatchObject({ source: "steam", presence: "offline", tiers: { aim1v1: "unranked" } })
    expect(list.steamOnly.map((f) => f.steamId)).toEqual([outsider])
    // The other side sees the link too
    expect((await friendsOf(reg1!)).friends.map((f) => f.steamId)).toEqual([me])

    // Running it again changes nothing and unfriended pairs are never re-added
    expect((await call(me!, "DELETE", `/friends/${reg1}`)).status).toBe(204)
    expect((await call(me!, "POST", "/friends/sync")).body).toEqual({ steamListAvailable: true, linked: 0 })
    expect((await friendsOf(me!)).friends.map((f) => f.steamId)).toEqual([reg2])
    // Steam dropping a friend does not remove the link
    lists.set(me!, [])
    await call(me!, "POST", "/friends/sync")
    expect((await friendsOf(me!)).friends.map((f) => f.steamId)).toEqual([reg2])
  })

  it("reports a private Steam list without failing", async () => {
    const [me] = await makeUsers(h.db, 1)
    lists.set(me!, null)
    const list = await friendsOf(me!)
    expect(list).toMatchObject({ friends: [], steamListAvailable: false, steamOnly: [] })
  })

  it("runs the request lifecycle: send, accept, unfriend, decline, cancel", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    expect((await call(a!, "POST", "/friends/requests", { steamId: a })).body.error).toBe("cannot_add_self")
    expect((await call(a!, "POST", "/friends/requests", { steamId: newSteamId() })).status).toBe(404)

    const sent = await call(a!, "POST", "/friends/requests", { steamId: b })
    expect(sent.status).toBe(201)
    const req = sent.body.request as FriendRequest
    expect(req).toMatchObject({ status: "pending", from: { steamId: a }, to: { steamId: b } })
    // Both sides are told, each with the other side's id
    const upd = h.notifier.ofType("friend_update")
    expect(upd.map((u) => [u.audience, (u.msg.payload as { steamId: string }).steamId])).toEqual([
      [{ kind: "users", steamIds: [a] }, b],
      [{ kind: "users", steamIds: [b] }, a],
    ])
    // Repeat is idempotent
    expect((await call(a!, "POST", "/friends/requests", { steamId: b })).status).toBe(200)
    expect((await friendsOf(b!)).incoming.map((r) => r.id)).toEqual([req.id])
    expect((await friendsOf(a!)).outgoing.map((r) => r.id)).toEqual([req.id])
    expect((await call(b!, "GET", "/friends/pending")).body).toMatchObject({ requests: 1, invites: [] })

    expect((await call(a!, "POST", `/friends/requests/${req.id}/accept`)).body.error).toBe("not_recipient")
    const acc = await call(b!, "POST", `/friends/requests/${req.id}/accept`)
    expect((acc.body.request as FriendRequest).status).toBe("accepted")
    expect((await call(b!, "POST", `/friends/requests/${req.id}/accept`)).body.error).toBe("request_not_pending")
    expect((await friendsOf(a!)).friends).toMatchObject([{ steamId: b, source: "request" }])
    expect((await call(a!, "POST", "/friends/requests", { steamId: b })).body.error).toBe("already_friends")

    expect((await call(b!, "DELETE", `/friends/${a}`)).status).toBe(204)
    expect((await friendsOf(a!)).friends).toEqual([])
    expect((await call(b!, "DELETE", `/friends/${a}`)).body.error).toBe("not_friends")

    // Decline by the target
    const r2 = (await call(c!, "POST", "/friends/requests", { steamId: a })).body.request as FriendRequest
    expect(((await call(a!, "POST", `/friends/requests/${r2.id}/decline`)).body.request as FriendRequest).status).toBe("declined")
    // Cancel by the sender
    const r3 = (await call(c!, "POST", "/friends/requests", { steamId: a })).body.request as FriendRequest
    expect((await call(a!, "DELETE", `/friends/requests/${r3.id}`)).body.error).toBe("not_sender")
    expect(((await call(c!, "DELETE", `/friends/requests/${r3.id}`)).body.request as FriendRequest).status).toBe("cancelled")
    expect((await friendsOf(a!)).incoming).toEqual([])

    // A request back to someone who already asked accepts theirs
    const r4 = (await call(c!, "POST", "/friends/requests", { steamId: b })).body.request as FriendRequest
    const back = await call(b!, "POST", "/friends/requests", { steamId: c })
    expect(back.body.request).toMatchObject({ id: r4.id, status: "accepted" })
    expect((await friendsOf(c!)).friends.map((f) => f.steamId)).toEqual([b])
  })

  it("keeps presence in Redis with a 60 s ttl and only tells friends", async () => {
    const [me, friend, stranger] = await makeUsers(h.db, 3)
    const [x, y] = orderedPair(me!, friend!)
    const { friendships } = await import("../../db/schema.js")
    await h.db.insert(friendships).values({ userA: x, userB: y, source: "request" })

    h.notifier.clear()
    await h.ctx.presence.heartbeat(me!)
    expect(await h.ctx.presence.getOne(me!)).toEqual({ state: "online" })
    const ttl = await h.redis.ttl(`presence:${me}`)
    expect(ttl).toBeGreaterThan(55)
    expect(ttl).toBeLessThanOrEqual(60)
    const pushes = h.notifier.ofType("friend_update")
    expect(pushes).toHaveLength(1)
    expect(pushes[0]!.audience).toEqual({ kind: "users", steamIds: [friend] })
    expect(pushes[0]!.msg.payload).toEqual({ kind: "presence", steamId: me, presence: "online" })
    expect(JSON.stringify(h.notifier.sent)).not.toContain(stranger!)

    // A second heartbeat only extends the key
    h.notifier.clear()
    await h.ctx.presence.heartbeat(me!)
    expect(h.notifier.ofType("friend_update")).toHaveLength(0)

    // Queue transitions move the state and carry the queued modes
    await h.ctx.queue.join(me!, ["aim1v1", "aim2v2"])
    expect(await h.ctx.presence.getOne(me!)).toEqual({ state: "queue", detail: { modes: ["aim1v1", "aim2v2"] } })
    expect((await friendsOf(friend!)).friends[0]).toMatchObject({ presence: "queue", detail: { modes: ["aim1v1", "aim2v2"] } })
    await h.ctx.queue.leave(me!)
    expect((await h.ctx.presence.getOne(me!)).state).toBe("online")

    // Match start moves to match. The friend's team comes first in the score
    const { matchId } = await h.ctx.flow.createDirectMatch({
      mode: "aim1v1",
      teams: [{ name: "A", steamIds: [stranger!] }, { name: "B", steamIds: [me!] }],
    })
    expect(await h.ctx.presence.getOne(me!)).toMatchObject({ state: "match", detail: { matchId, mode: "aim1v1", score: [0, 0] } })

    // Each round end pushes the live score to friends only
    const { matches } = await import("../../db/schema.js")
    await h.db.update(matches).set({ status: "live", mapId: "aim_map" }).where(eq(matches.id, matchId))
    h.notifier.clear()
    await h.ctx.flow.handleEvent(matchId, { type: "round_end", round: 1, winnerTeam: "B", score: { A: 0, B: 1 } })
    const live = h.notifier.ofType("friend_update")
    expect(live).toHaveLength(1)
    expect(live[0]!.audience).toEqual({ kind: "users", steamIds: [friend] })
    expect(live[0]!.msg.payload).toEqual({
      kind: "presence",
      steamId: me,
      presence: "match",
      detail: { matchId, mode: "aim1v1", mapId: "aim_map", score: [1, 0] },
    })
    expect((await friendsOf(friend!)).friends[0]!.detail).toMatchObject({ score: [1, 0], mapId: "aim_map" })

    // A lapsed key becomes offline for friends on the next sweep
    h.notifier.clear()
    await h.redis.del(`presence:${me}`)
    h.clock.advance(61_000)
    expect(await h.ctx.presence.sweep()).toContain(me)
    const off = h.notifier.ofType("friend_update").filter((m) => (m.msg.payload as { steamId: string }).steamId === me)
    expect(off).toHaveLength(1)
    expect(off[0]!.audience).toEqual({ kind: "users", steamIds: [friend] })
    expect((off[0]!.msg.payload as { presence: string }).presence).toBe("offline")
  })

  it("invites a friend in-site and accept joins the party", async () => {
    const [host, guest, stranger] = await makeUsers(h.db, 3)
    const [x, y] = orderedPair(host!, guest!)
    const { friendships } = await import("../../db/schema.js")
    await h.db.insert(friendships).values({ userA: x, userB: y, source: "steam" })

    expect((await call(host!, "POST", "/parties/invites", { steamId: stranger })).body.error).toBe("not_friends")
    expect(await h.ctx.parties.partyOf(host!)).toBeNull()

    h.notifier.clear()
    const sent = await call(host!, "POST", "/parties/invites", { steamId: guest })
    expect(sent.status).toBe(201)
    const invite = sent.body.invite as PartyInvite
    // The party was created for the sender
    const party = await h.ctx.parties.partyOf(host!)
    expect(party).not.toBeNull()
    expect(invite).toMatchObject({ partyId: party!.partyId, from: { steamId: host }, inviteCode: party!.inviteToken })
    const pushed = h.notifier.ofType("party_invite")
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.audience).toEqual({ kind: "users", steamIds: [guest] })
    expect((await call(guest!, "GET", "/friends/pending")).body.invites).toHaveLength(1)

    expect((await call(stranger!, "POST", `/parties/invites/${invite.id}/accept`)).status).toBe(404)
    const acc = await call(guest!, "POST", `/parties/invites/${invite.id}/accept`)
    expect(acc.status).toBe(200)
    expect((acc.body.invite as PartyInvite).status).toBe("accepted")
    expect((await h.ctx.parties.partyOf(guest!))!.partyId).toBe(party!.partyId)
    expect((await h.ctx.parties.partyOf(host!))!.memberSteamIds).toEqual([host, guest])
    expect((await call(guest!, "POST", `/parties/invites/${invite.id}/accept`)).body.error).toBe("invite_not_pending")
    expect((await call(host!, "POST", "/parties/invites", { steamId: guest })).body.error).toBe("already_in_party")
  })

  it("expires, declines and survives a rotated invite code", async () => {
    const [host, guest] = await makeUsers(h.db, 2)
    const [x, y] = orderedPair(host!, guest!)
    const { friendships } = await import("../../db/schema.js")
    await h.db.insert(friendships).values({ userA: x, userB: y, source: "request" })

    const first = (await call(host!, "POST", "/parties/invites", { steamId: guest })).body.invite as PartyInvite
    expect(((await call(guest!, "POST", `/parties/invites/${first.id}/decline`)).body.invite as PartyInvite).status).toBe("declined")

    const second = (await call(host!, "POST", "/parties/invites", { steamId: guest })).body.invite as PartyInvite
    h.clock.advance(601_000)
    expect((await call(guest!, "POST", `/parties/invites/${second.id}/accept`)).status).toBe(410)

    const third = (await call(host!, "POST", "/parties/invites", { steamId: guest })).body.invite as PartyInvite
    await h.ctx.parties.rotateInvite(host!)
    expect((await call(guest!, "POST", `/parties/invites/${third.id}/accept`)).status).toBe(200)
    expect((await h.ctx.parties.partyOf(guest!))!.leaderSteamId).toBe(host)

    const fourth = await h.db.select().from(partyInvites).where(eq(partyInvites.status, "pending"))
    expect(fourth).toHaveLength(0)
  })

  it("lists recent players who are not friends", async () => {
    const [me, opp, friend] = await makeUsers(h.db, 3)
    const [x, y] = orderedPair(me!, friend!)
    const { friendships } = await import("../../db/schema.js")
    await h.db.insert(friendships).values({ userA: x, userB: y, source: "request" })
    await h.ctx.flow.createDirectMatch({ mode: "aim1v1", teams: [{ name: "A", steamIds: [me!] }, { name: "B", steamIds: [friend!] }] })
    const { matchId } = await h.ctx.flow.createDirectMatch({ mode: "aim1v1", teams: [{ name: "A", steamIds: [me!] }, { name: "B", steamIds: [opp!] }] })
    await call(me!, "POST", "/friends/requests", { steamId: opp })
    const r = await call(me!, "GET", "/friends/recent")
    expect(r.body.players).toMatchObject([{ steamId: opp, matchId, mode: "aim1v1", requested: true }])
  })
})
