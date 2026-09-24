import { randomUUID } from "node:crypto"
import { MODES, type Mode } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, makeUsers, withServers } from "../../../test/helpers.js"
import { bans, hosts, matchPlayers, matches, parties, queueTickets, ratings, users } from "../../db/schema.js"
import type { Db } from "../../db/client.js"
import { buildDistribution } from "./distribution.js"
import { estimateFromTickets, median } from "./eta.js"
import { namePattern } from "./rank.js"
import { availabilityKey, buildStatus, type StatusInput } from "./status.js"

const none = Object.fromEntries(MODES.map((m) => [m, []])) as unknown as Record<Mode, string[]>

describe("queue eta", () => {
  it("takes the median", () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it("is null under three matches and uses one sample per match", () => {
    const t = (matchId: string, waitSec: number) => ({ matchId, enqueuedAt: 0, matchedAt: waitSec * 1000 })
    expect(estimateFromTickets([t("a", 10), t("a", 20), t("b", 30), t("b", 40)])).toBeNull()
    // Match means are 15, 35 and 100
    expect(estimateFromTickets([t("a", 10), t("a", 20), t("b", 30), t("b", 40), t("c", 100)])).toBe(35)
    expect(estimateFromTickets([{ matchId: null, enqueuedAt: 0, matchedAt: 1 }, t("a", 1), t("b", 2)])).toBeNull()
  })
})

describe("tier distribution", () => {
  it("fills every tier and computes shares", () => {
    const d = buildDistribution("aim1v1", { bronze: 1, silver: 2, gold: 1 })
    expect(d.total).toBe(4)
    expect(d.tiers.map((t) => t.tier)).toEqual(["iron", "bronze", "silver", "gold", "platinum", "elite"])
    expect(d.tiers.find((t) => t.tier === "silver")).toEqual({ tier: "silver", count: 2, pct: 0.5 })
    expect(d.you).toBeUndefined()
  })

  it("places you by percentile", () => {
    const d = buildDistribution("aim1v1", { silver: 3 }, { rating: 1650, below: 2, placed: true })
    expect(d.you).toEqual({ tier: "gold", rating: 1650, percentile: 66.7, placed: true })
    expect(buildDistribution("aim1v1", {}, { rating: 900, below: 0, placed: false }).you?.percentile).toBe(0)
  })
})

describe("status", () => {
  const base: StatusInput = { hosts: [], surgeEnabled: false, surgeActive: 0, unresolved: none, now: Date.parse("2026-09-23T12:00:00Z") }

  it("reports no servers when nothing is online and surge is off", () => {
    const s = buildStatus(base)
    expect(s.regions).toEqual([{ region: "eu", hosts: 0, hostsOnline: 0, slotsTotal: 0, slotsFree: 0, updating: false }])
    expect(s.modes.every((m) => !m.available && m.reason === "no_servers")).toBe(true)
    expect(s.updatedAt).toBe("2026-09-23T12:00:00.000Z")
  })

  it("counts online capacity and flags updates", () => {
    const s = buildStatus({
      ...base,
      hosts: [
        { status: "online", slotsTotal: 8, slotsFree: 3 },
        { status: "updating", slotsTotal: 8, slotsFree: 8 },
        { status: "offline", slotsTotal: 4, slotsFree: 4 },
      ],
    })
    expect(s.regions[0]).toEqual({ region: "eu", hosts: 3, hostsOnline: 2, slotsTotal: 8, slotsFree: 3, updating: true })
    expect(s.modes.every((m) => m.available)).toBe(true)
  })

  it("keeps modes open on surge and closes unconfigured ones", () => {
    const s = buildStatus({
      ...base,
      hosts: [{ status: "updating", slotsTotal: 8, slotsFree: 8 }],
      surgeEnabled: true,
      surgeActive: 2,
      unresolved: { ...none, rush3v3: ["cs2.gameMode"] },
    })
    expect(s.surge).toEqual({ enabled: true, active: 2 })
    expect(s.modes).toEqual([
      { mode: "aim1v1", available: true },
      { mode: "aim2v2", available: true },
      { mode: "rush3v3", available: false, reason: "not_configured" },
      { mode: "rush1v1", available: true },
    ])
    const off = buildStatus({ ...base, disabled: ["rush1v1"] })
    expect(off.modes.at(-1)).toEqual({ mode: "rush1v1", available: false, reason: "disabled" })
    const upd = buildStatus({ ...base, hosts: [{ status: "updating", slotsTotal: 8, slotsFree: 8 }] })
    expect(upd.modes[0]).toEqual({ mode: "aim1v1", available: false, reason: "servers_updating" })
  })

  it("diffs availability only, not slot counts or time", () => {
    const busy = buildStatus({ ...base, hosts: [{ status: "online", slotsTotal: 8, slotsFree: 1 }] })
    const idle = buildStatus({ ...base, hosts: [{ status: "online", slotsTotal: 8, slotsFree: 8 }], now: base.now + 60_000 })
    expect(availabilityKey(busy)).toBe(availabilityKey(idle))
    // The CS2 update window and an admin closure both change it
    const updating = buildStatus({ ...base, hosts: [{ status: "updating", slotsTotal: 8, slotsFree: 8 }] })
    expect(availabilityKey(updating)).not.toBe(availabilityKey(idle))
    const closed = buildStatus({ ...base, hosts: [{ status: "online", slotsTotal: 8, slotsFree: 8 }], closed: ["aim1v1"] })
    expect(availabilityKey(closed)).not.toBe(availabilityKey(idle))
  })
})

describe("stats routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  let friendsOf: string[] = []
  const fetchStub = (async (url: string) => {
    if (String(url).includes("GetFriendList")) {
      return new Response(JSON.stringify({ friendslist: { friends: friendsOf.map((steamid) => ({ steamid, relationship: "friend", friend_since: 1 })) } }))
    }
    return new Response("{}", { status: 500 })
  }) as unknown as typeof fetch

  beforeAll(async () => {
    h = await createAppHarness({ fetch: fetchStub, env: { STEAM_API_KEY: "test-key" } })
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await createTestDb()
    await h.redis.flushall()
  })

  const login = async (steamId: string) => ({ rs_sid: h.app.signCookie(await h.ctx.sessions.create(steamId)) })

  async function rate(db: Db, steamId: string, mode: Mode, rating: number, matchesPlayed = 25) {
    const wins = Math.min(matchesPlayed, 10)
    await db.insert(ratings).values({ steamId, mode, rating, rd: 80, volatility: 0.06, matchesPlayed, wins, losses: matchesPlayed - wins })
  }

  async function newMatch(mode: Mode, status: "live" | "finished" | "ready", extra: Partial<typeof matches.$inferInsert> = {}) {
    const [m] = await h.db
      .insert(matches)
      .values({
        mode,
        status,
        teams: [
          { name: "A", steamIds: [] },
          { name: "B", steamIds: [] },
        ],
        webhookSecret: "s",
        ...extra,
      })
      .returning()
    return m!
  }

  it("fills estimatedSec from recent matched tickets", async () => {
    const ids = await makeUsers(h.db, 4)
    const [party] = await h.db.insert(parties).values({ leaderSteamId: ids[0]!, inviteToken: "tok" }).returning()
    const now = h.ctx.now()
    const ticket = (waitSec: number, matchId: string, ageMin = 5) => ({
      partyId: party!.id,
      modes: ["aim1v1" as Mode],
      steamIds: [ids[0]!],
      ratings: {},
      status: "matched" as const,
      matchId,
      matchedMode: "aim1v1" as Mode,
      enqueuedAt: new Date(now - ageMin * 60_000 - waitSec * 1000),
      updatedAt: new Date(now - ageMin * 60_000),
    })
    await h.db.insert(queueTickets).values([ticket(20, randomUUID()), ticket(40, randomUUID()), ticket(900, randomUUID(), 45)])
    await withServers({ ctx: h.ctx, env: h.ctx.env })
    await h.ctx.queue.join(ids[1]!, ["aim1v1"])
    let st = await h.ctx.queue.status(ids[1]!)
    expect(st.modes[0]!.estimatedSec).toBeNull()

    await h.db.insert(queueTickets).values(ticket(60, randomUUID()))
    // A new source skips the cache
    const { createEtaSource } = await import("./eta.js")
    h.ctx.queue.setEtaSource(createEtaSource(h.db, h.ctx.now))
    st = await h.ctx.queue.status(ids[1]!)
    expect(st.modes[0]!.estimatedSec).toBe(40)
  })

  it("serves the tier distribution with your percentile", async () => {
    const ids = await makeUsers(h.db, 6)
    await rate(h.db, ids[0]!, "aim1v1", 1100)
    await rate(h.db, ids[1]!, "aim1v1", 1400)
    await rate(h.db, ids[2]!, "aim1v1", 1450)
    await rate(h.db, ids[3]!, "aim1v1", 2300)
    // Unplaced and banned players are left out
    await rate(h.db, ids[4]!, "aim1v1", 1500, 0)
    await rate(h.db, ids[5]!, "aim1v1", 1500)
    await h.db.insert(bans).values({ steamId: ids[5]!, reason: "test" })

    const anon = (await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/distribution" })).json()
    expect(anon.total).toBe(4)
    expect(anon.tiers.map((t: { count: number }) => t.count)).toEqual([0, 1, 2, 0, 0, 1])
    expect(anon.you).toBeUndefined()

    const res = await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/distribution", cookies: await login(ids[2]!) })
    expect(res.json().you).toEqual({ tier: "silver", rating: 1450, percentile: 50, placed: true })
    // With no matches played yet, there is no rating to show at all
    const unplaced = await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/distribution", cookies: await login(ids[4]!) })
    expect(unplaced.json().you).toBeUndefined()
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/nope/distribution" })).statusCode).toBe(404)
  })

  it("limits the friends leaderboard to friends and self", async () => {
    const ids = await makeUsers(h.db, 4)
    const [me, f1, f2, stranger] = ids as [string, string, string, string]
    friendsOf = [f1, f2]
    await rate(h.db, me, "rush3v3", 1500)
    await rate(h.db, f1, "rush3v3", 1700)
    // f2 has never played a match in this mode, so it has no rating row and is left out entirely
    await rate(h.db, stranger, "rush3v3", 2000)
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/rush3v3/friends" })).statusCode).toBe(401)
    const res = await h.app.inject({ method: "GET", url: "/leaderboard/rush3v3/friends", cookies: await login(me) })
    const body = res.json()
    expect(body.friendsAvailable).toBe(true)
    expect(body.rows.map((r: { steamId: string; rank: number | null; placed: boolean }) => [r.rank, r.placed, r.steamId])).toEqual([
      [1, true, f1],
      [2, true, me],
    ])
  })

  it("finds the viewer's rank and the offset of its page", async () => {
    const ids = await makeUsers(h.db, 7)
    const [top, tieLow, tieHigh, me, banned, unplaced, unrated] = ids as [string, string, string, string, string, string, string]
    await rate(h.db, top, "aim1v1", 2000)
    // Equal ratings break on steamId like the table does
    const [a, b] = [tieLow, tieHigh].sort()
    await rate(h.db, a!, "aim1v1", 1800)
    await rate(h.db, b!, "aim1v1", 1800)
    await rate(h.db, me, "aim1v1", 1700)
    await rate(h.db, banned, "aim1v1", 1900)
    await h.db.insert(bans).values({ steamId: banned, reason: "test" })
    await rate(h.db, unplaced, "aim1v1", 2500, 0)

    expect((await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me" })).statusCode).toBe(401)
    const mine = (await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me?limit=2", cookies: await login(me) })).json()
    expect(mine).toMatchObject({ mode: "aim1v1", placed: true, rank: 4, offset: 2, limit: 2, needed: 0 })
    const board = (await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1?offset=2&limit=2" })).json()
    expect(board.rows.map((r: { rank: number; steamId: string }) => [r.rank, r.steamId])).toEqual([
      [3, b],
      [4, me],
    ])
    const tie = (await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me", cookies: await login(b!) })).json()
    expect(tie).toMatchObject({ rank: 3, offset: 0, limit: 50 })

    const early = (await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me", cookies: await login(unplaced) })).json()
    expect(early).toMatchObject({ placed: false, rank: null, offset: null, matches: 0, needed: 1 })
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me", cookies: await login(banned) })).json()).toMatchObject({
      placed: false,
      rank: null,
    })
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me", cookies: await login(unrated) })).json()).toMatchObject({
      placed: false,
      matches: 0,
      needed: 1,
    })
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1/me?limit=0", cookies: await login(me) })).statusCode).toBe(400)
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/nope/me", cookies: await login(me) })).statusCode).toBe(404)
  })

  it("searches the leaderboard by name and keeps global ranks", async () => {
    const ids = await makeUsers(h.db, 5)
    const names = ["Vexa", "kolt", "vex_ash", "Lovex", "vexbanned"]
    for (const [i, id] of ids.entries()) await h.db.update(users).set({ displayName: names[i]! }).where(eq(users.steamId, id))
    await rate(h.db, ids[0]!, "rush3v3", 1600)
    await rate(h.db, ids[1]!, "rush3v3", 2000)
    await rate(h.db, ids[2]!, "rush3v3", 1500)
    await rate(h.db, ids[3]!, "rush3v3", 1900)
    await rate(h.db, ids[4]!, "rush3v3", 2100)
    await h.db.insert(bans).values({ steamId: ids[4]!, reason: "test" })

    const search = async (q: string, extra = "") =>
      (await h.app.inject({ method: "GET", url: `/leaderboard/rush3v3?q=${encodeURIComponent(q)}${extra}` })).json()
    // Two letters match the prefix only, case insensitive
    const short = await search("VE")
    expect(short.total).toBe(2)
    expect(short.rows.map((r: { rank: number; displayName: string }) => [r.rank, r.displayName])).toEqual([
      [3, "Vexa"],
      [4, "vex_ash"],
    ])
    // Three or more letters match anywhere in the name
    const long = await search("vex")
    expect(long.rows.map((r: { rank: number; displayName: string }) => [r.rank, r.displayName])).toEqual([
      [2, "Lovex"],
      [3, "Vexa"],
      [4, "vex_ash"],
    ])
    const paged = await search("vex", "&offset=1&limit=1")
    expect(paged.total).toBe(3)
    expect(paged.rows.map((r: { rank: number }) => r.rank)).toEqual([3])
    // Wildcards are literal
    expect((await search("x_a")).rows.map((r: { displayName: string }) => r.displayName)).toEqual(["vex_ash"])
    expect((await search("%")).total).toBe(0)
    expect((await search("  ")).total).toBe(4)
    expect((await h.app.inject({ method: "GET", url: `/leaderboard/rush3v3?q=${"a".repeat(33)}` })).statusCode).toBe(400)
    expect(namePattern("A_b")).toBe("%a\\_b%")
  })

  it("serves the public status page", async () => {
    await withServers({ ctx: h.ctx, env: h.ctx.env })
    const res = await h.app.inject({ method: "GET", url: "/status" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.regions).toEqual([{ region: "eu", hosts: 1, hostsOnline: 1, slotsTotal: 4, slotsFree: 4, updating: false }])
    expect(body.surge).toEqual({ enabled: false, active: 0 })
    // The Rush test queue is off unless its env flag is set
    expect(body.modes.filter((m: { available: boolean }) => !m.available)).toEqual([{ mode: "rush1v1", available: false, reason: "disabled" }])
    await h.db.update(hosts).set({ status: "updating" })
    const upd = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(upd.regions[0].updating).toBe(true)
    expect(upd.modes[0]).toEqual({ mode: "aim1v1", available: false, reason: "servers_updating" })
  })

  it("blocks capacity reasons only in production", async () => {
    const [a] = await makeUsers(h.db, 1)
    h.clock.advance(6000)
    // No hosts synced. Outside production the join still goes through
    const res = await h.app.inject({ method: "POST", url: "/queue/join", payload: { modes: ["aim1v1"] }, cookies: await login(a!) })
    expect(res.statusCode).toBe(200)
    const { createAvailabilitySource } = await import("./status.js")
    const prod = createAvailabilitySource({ ...h.ctx, env: { ...h.ctx.env, NODE_ENV: "production" } })
    expect(await prod("aim1v1")).not.toBeNull()
    const dev = createAvailabilitySource(h.ctx)
    expect(await dev("aim1v1")).toBeNull()
    h.ctx.queue.setAvailabilitySource(prod)
    const [b] = await makeUsers(h.db, 1)
    const blocked = await h.app.inject({ method: "POST", url: "/queue/join", payload: { modes: ["aim1v1"] }, cookies: await login(b!) })
    expect(blocked.statusCode).toBe(503)
    expect(blocked.json()).toMatchObject({ error: "mode_unavailable" })
    h.ctx.queue.setAvailabilitySource(dev)
  })

  it("groups hosts by region", async () => {
    await h.ctx.allocator.syncHosts(["http://agent.test:8080", "na=http://agent-na.test:8080"])
    const { parseAgentEntry } = await import("../match/allocator.js")
    expect(parseAgentEntry("http://x.test:1/?a=b")).toEqual({ region: "eu", url: "http://x.test:1/?a=b" })
    const body = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(body.regions.map((r: { region: string; hosts: number }) => [r.region, r.hosts])).toEqual([
      ["eu", 1],
      ["na", 1],
    ])
  })

  it("lists live matches highest rated first", async () => {
    const ids = await makeUsers(h.db, 4)
    await rate(h.db, ids[0]!, "aim1v1", 1500)
    await rate(h.db, ids[1]!, "aim1v1", 1900)
    await rate(h.db, ids[2]!, "aim1v1", 2100)
    const low = await newMatch("aim1v1", "live", { mapId: "aim_map", score: { A: 3, B: 5 }, startedAt: new Date() })
    const high = await newMatch("aim1v1", "ready")
    await newMatch("aim1v1", "finished")
    await h.db.insert(matchPlayers).values([
      { matchId: low.id, steamId: ids[0]!, team: 0 },
      { matchId: low.id, steamId: ids[1]!, team: 1 },
      { matchId: high.id, steamId: ids[2]!, team: 0 },
      { matchId: high.id, steamId: ids[3]!, team: 1 },
    ])
    const body = (await h.app.inject({ method: "GET", url: "/matches/live?limit=6" })).json()
    expect(body.matches.map((m: { id: string }) => m.id)).toEqual([high.id, low.id])
    expect(body.matches[1]).toMatchObject({
      mode: "aim1v1",
      mapId: "aim_map",
      status: "live",
      teams: [
        { name: "A", score: 3, players: [{ steamId: ids[0], displayName: expect.any(String), avatarUrl: null }] },
        { name: "B", score: 5, players: [{ steamId: ids[1], displayName: expect.any(String), avatarUrl: null }] },
      ],
      topRating: 1900,
    })
    expect(body.matches[1].tournament).toBeUndefined()
    expect(body.matches[0].startedAt).toBeNull()
    expect((await h.app.inject({ method: "GET", url: "/matches/live?limit=0" })).statusCode).toBe(400)
  })
})
