import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import adminPlugin from "./index.js"
import { MemoryAdminStore } from "./memory-store.js"
import type { UserRecord } from "./store.js"
import type {
  AdminEventKind,
  HostSnapshot,
  MatchDetailView,
  QueueTicketSnapshot,
  RecentEventSnapshot,
  TrustLevel,
} from "./types.js"

const T0 = new Date("2026-09-23T12:00:00Z")
const ADMIN = "76561198000000001"
const PLAYER = "76561198000000002"
const OTHER = "76561198000000003"
const TICKET = "11111111-1111-4111-8111-111111111111"
const MATCH = "22222222-2222-4222-8222-222222222222"
const OLD_MATCH = "33333333-3333-4333-8333-333333333333"
const HOST = "44444444-4444-4444-8444-444444444444"

function userRecord(steamId: string, name: string): UserRecord {
  return {
    user: {
      steamId,
      displayName: name,
      avatarUrl: null,
      region: "eu",
      countryCode: "DE",
      profileUrl: null,
      createdAt: T0.toISOString(),
      lastLoginAt: T0.toISOString(),
    },
    steam: null,
    trust: { level: "new", reason: "", locked: false, updatedAt: T0.toISOString() },
    trustSignals: [],
    ratings: [],
    recentMatches: [],
    bans: [],
    activeBan: null,
    cooldowns: [],
    reports: { received: 0, open: 0 },
    flags: { open: 0, total: 0 },
  }
}

function finishedMatch(): MatchDetailView {
  return {
    id: OLD_MATCH,
    mode: "aim1v1",
    status: "finished",
    source: "queue",
    region: "eu",
    teams: [
      { name: "team_a", players: [{ steamId: PLAYER, displayName: "vexa", avatarUrl: null }] },
      { name: "team_b", players: [{ steamId: OTHER, displayName: "kolt", avatarUrl: null }] },
    ],
    mapId: "aim_map",
    hostId: HOST,
    server: null,
    winnerTeam: "team_a",
    score: { team_a: 16, team_b: 9 },
    tournamentId: null,
    cancelReason: null,
    createdAt: new Date(T0.getTime() - 3600_000).toISOString(),
    startedAt: null,
    endedAt: new Date(T0.getTime() - 1800_000).toISOString(),
    maps: ["aim_map"],
    acceptDeadline: null,
    readyAt: null,
    players: [],
    rounds: [],
  }
}

async function harness() {
  const store = new MemoryAdminStore()
  store.users.set(PLAYER, userRecord(PLAYER, "vexa"))
  store.users.set(OTHER, userRecord(OTHER, "kolt"))
  store.users.set(ADMIN, userRecord(ADMIN, "boss"))
  store.matches.push({
    ...finishedMatch(),
    id: MATCH,
    status: "live",
    server: { ip: "203.0.113.5", port: 27015, connect: "connect 203.0.113.5:27015; password x" },
    createdAt: T0.toISOString(),
    endedAt: null,
    winnerTeam: null,
    score: null,
  })
  store.matches.push(finishedMatch())

  const queue: QueueTicketSnapshot[] = [
    {
      id: TICKET,
      partyId: "55555555-5555-4555-8555-555555555555",
      modes: ["aim1v1", "aim2v2"],
      steamIds: [PLAYER],
      ratings: { aim1v1: 1510, aim2v2: 1490 },
      region: "eu",
      enqueuedAt: T0.getTime() - 90_000,
    },
  ]
  const hosts: HostSnapshot[] = [
    {
      id: HOST,
      name: "ax-1",
      publicIp: "203.0.113.5",
      status: "online",
      cs2Version: "1.40.9.1",
      updating: false,
      slots: { total: 16, free: 15 },
      lastSeenAt: T0,
      servers: [{ slotIndex: 0, port: 27015, status: "running", matchId: MATCH }],
    },
  ]
  const events: RecentEventSnapshot[] = [
    { id: "e1", kind: "webhook", at: T0.getTime() - 60_000, type: "match_started", message: "ok", matchId: MATCH },
    { id: "e2", kind: "webhook", at: T0.getTime() - 120_000, type: "round_end", message: "bad signature", ok: false },
    { id: "e3", kind: "error", at: T0.getTime() - 30_000, type: "allocation_failed", message: "no free slots" },
    { id: "e4", kind: "error", at: T0.getTime() - 3 * 3600_000, type: "old", message: "old" },
  ]

  const calls = {
    removeTicket: [] as string[],
    cancelMatch: [] as [string, string][],
    setTrustLevel: [] as [string, TrustLevel][],
    ban: [] as [string, string, Date | null | undefined][],
    unban: [] as string[],
    notified: [] as string[],
    emitted: [] as [AdminEventKind, unknown][],
  }
  const state = { banned: new Set<string>(), redisDown: false }

  const app: FastifyInstance = Fastify()
  await app.register(adminPlugin, {
    db: undefined as never,
    store,
    now: () => T0,
    redis: {
      ping: async () => {
        if (state.redisDown) throw new Error("redis down")
        return "PONG"
      },
    },
    isAdmin: (id) => id === ADMIN,
    authenticate: async (req) => (req.headers["x-steam-id"] as string | undefined) ?? null,
    getQueueSnapshot: async () => queue,
    getHosts: async () => hosts,
    removeTicket: async (id) => {
      calls.removeTicket.push(id)
      const i = queue.findIndex((t) => t.id === id)
      if (i < 0) return false
      queue.splice(i, 1)
      return true
    },
    cancelMatch: async (id, reason) => {
      calls.cancelMatch.push([id, reason])
      return store.matches.some((m) => m.id === id && m.status === "live")
    },
    setTrustLevel: async (id, level) => {
      calls.setTrustLevel.push([id, level])
    },
    ban: async (id, reason, until) => {
      calls.ban.push([id, reason, until])
      state.banned.add(id)
    },
    unban: async (id) => {
      calls.unban.push(id)
      return state.banned.delete(id)
    },
    recentEvents: async (limit) => events.slice(0, limit),
    emitAdmin: (kind, payload) => calls.emitted.push([kind, payload]),
    notifyQueueStatus: async (id) => {
      calls.notified.push(id)
    },
  })
  await app.ready()

  const as = (steamId: string | null) => ({
    get: (url: string) => app.inject({ method: "GET", url, headers: steamId ? { "x-steam-id": steamId } : {} }),
    post: (url: string, body?: unknown) =>
      app.inject({
        method: "POST",
        url,
        headers: steamId ? { "x-steam-id": steamId } : {},
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      }),
  })

  return { app, store, calls, state, queue, admin: as(ADMIN), player: as(PLAYER), anon: as(null) }
}

let h: Awaited<ReturnType<typeof harness>>

afterEach(async () => {
  await h?.app.close()
})

const GETS = [
  "/admin/overview",
  "/admin/queue",
  "/admin/matches",
  `/admin/matches/${MATCH}`,
  "/admin/hosts",
  `/admin/users/${PLAYER}`,
  "/admin/users?q=vex",
  "/admin/events",
]
const POSTS: [string, unknown][] = [
  [`/admin/queue/${TICKET}/remove`, {}],
  [`/admin/matches/${MATCH}/cancel`, { reason: "test" }],
  [`/admin/users/${PLAYER}/ban`, { reason: "test" }],
  [`/admin/users/${PLAYER}/unban`, {}],
  [`/admin/users/${PLAYER}/trust`, { level: "trusted" }],
  [`/admin/users/${PLAYER}/cooldown/clear`, {}],
]

describe("auth gating", () => {
  it("returns the stock 404 to anonymous users and non admins on every route", async () => {
    h = await harness()
    const missing = await h.admin.get("/admin/nope")
    expect(missing.statusCode).toBe(404)

    for (const who of [h.anon, h.player]) {
      for (const url of GETS) {
        const res = await who.get(url)
        expect(res.statusCode, url).toBe(404)
        expect(res.json().message).toMatch(/not found/i)
      }
      for (const [url, body] of POSTS) {
        const res = await who.post(url, body)
        expect(res.statusCode, url).toBe(404)
      }
    }
    expect(h.calls.removeTicket).toEqual([])
    expect(h.calls.cancelMatch).toEqual([])
    expect(h.calls.ban).toEqual([])
    expect(h.calls.unban).toEqual([])
    expect(h.calls.setTrustLevel).toEqual([])
    expect(h.store.audit).toEqual([])
  })

  it("treats a throwing authenticate as signed out", async () => {
    h = await harness()
    const app = Fastify()
    await app.register(adminPlugin, {
      db: undefined as never,
      store: h.store,
      redis: { ping: async () => "PONG" },
      isAdmin: () => true,
      authenticate: async () => {
        throw new Error("bad cookie")
      },
      getQueueSnapshot: async () => [],
      getHosts: async () => [],
      removeTicket: async () => true,
      cancelMatch: async () => true,
      setTrustLevel: async () => {},
      ban: async () => {},
      unban: async () => true,
      recentEvents: async () => [],
      emitAdmin: () => {},
    })
    const res = await app.inject({ method: "GET", url: "/admin/overview" })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("lets admins through", async () => {
    h = await harness()
    for (const url of GETS) expect((await h.admin.get(url)).statusCode, url).toBe(200)
  })
})

describe("read routes", () => {
  it("overview counts queue, matches, hosts, events and health", async () => {
    h = await harness()
    h.state.redisDown = true
    const o = (await h.admin.get("/admin/overview")).json()
    expect(o.queue).toEqual([
      { mode: "aim1v1", tickets: 1, players: 1, longestWaitSec: 90 },
      { mode: "aim2v2", tickets: 1, players: 1, longestWaitSec: 90 },
      { mode: "rush3v3", tickets: 0, players: 0, longestWaitSec: 0 },
      { mode: "rush1v1", tickets: 0, players: 0, longestWaitSec: 0 },
    ])
    expect(o.matches.active).toBe(1)
    expect(o.matches.byStatus).toEqual({ live: 1 })
    expect(o.hosts).toEqual({ total: 1, online: 1, updating: 0, slotsTotal: 16, slotsFree: 15 })
    expect(o.users.total).toBe(3)
    expect(o.events).toEqual({ errorsLastHour: 1, webhooksLastHour: 2, failedWebhooksLastHour: 1 })
    expect(o.health.db.ok).toBe(true)
    expect(o.health.redis).toMatchObject({ ok: false, error: "redis down" })
    expect(o.health.queue.ok).toBe(true)
  })

  it("queue groups tickets per mode with names, rating and wait", async () => {
    h = await harness()
    const q = (await h.admin.get("/admin/queue")).json()
    expect(q.totalTickets).toBe(1)
    expect(q.totalPlayers).toBe(1)
    const aim1 = q.modes.find((m: { mode: string }) => m.mode === "aim1v1")
    expect(aim1.tickets[0]).toMatchObject({
      id: TICKET,
      size: 1,
      rating: 1510,
      waitSec: 90,
      players: [{ steamId: PLAYER, displayName: "vexa" }],
    })
    const aim2 = q.modes.find((m: { mode: string }) => m.mode === "aim2v2")
    expect(aim2.tickets[0].rating).toBe(1490)
    expect(q.modes.find((m: { mode: string }) => m.mode === "rush3v3").tickets).toEqual([])
  })

  it("matches lists active and recent from the store", async () => {
    h = await harness()
    const active = (await h.admin.get("/admin/matches?status=active")).json()
    expect(active.matches).toHaveLength(1)
    expect(active.matches[0]).toMatchObject({
      id: MATCH,
      status: "live",
      server: { ip: "203.0.113.5", port: 27015 },
      teams: [{ name: "team_a", players: [{ displayName: "vexa" }] }, { name: "team_b", players: [{ displayName: "kolt" }] }],
    })
    const recent = (await h.admin.get("/admin/matches?status=recent")).json()
    expect(recent.matches.map((m: { id: string }) => m.id)).toEqual([OLD_MATCH])
    const byStatus = (await h.admin.get("/admin/matches?status=finished,live")).json()
    expect(byStatus.matches).toHaveLength(2)
    expect((await h.admin.get("/admin/matches?status=bogus")).statusCode).toBe(400)
  })

  it("match detail shows server info and 404s on unknown ids", async () => {
    h = await harness()
    const m = (await h.admin.get(`/admin/matches/${MATCH}`)).json().match
    expect(m.server).toMatchObject({ ip: "203.0.113.5", port: 27015 })
    expect((await h.admin.get(`/admin/matches/${OLD_MATCH}`)).json().match.winnerTeam).toBe("team_a")
    expect((await h.admin.get("/admin/matches/66666666-6666-4666-8666-666666666666")).statusCode).toBe(404)
    expect((await h.admin.get("/admin/matches/not-a-uuid")).statusCode).toBe(404)
  })

  it("hosts reports slots used and servers", async () => {
    h = await harness()
    const { hosts } = (await h.admin.get("/admin/hosts")).json()
    expect(hosts[0]).toMatchObject({
      name: "ax-1",
      cs2Version: "1.40.9.1",
      updating: false,
      slots: { total: 16, free: 15, used: 1 },
      lastSeenAt: T0.toISOString(),
    })
    expect(hosts[0].servers).toHaveLength(1)
  })

  it("user detail includes audit rows for that user", async () => {
    h = await harness()
    await h.admin.post(`/admin/users/${PLAYER}/trust`, { level: "verified" })
    const u = (await h.admin.get(`/admin/users/${PLAYER}`)).json()
    expect(u.user.displayName).toBe("vexa")
    expect(u.audit).toHaveLength(1)
    expect(u.audit[0]).toMatchObject({ action: "user.trust", adminSteamId: ADMIN })
    expect((await h.admin.get("/admin/users/76561198999999999")).statusCode).toBe(404)
    expect((await h.admin.get("/admin/users/abc")).statusCode).toBe(404)
  })

  it("events returns normalised rows and honours the limit", async () => {
    h = await harness()
    const { events } = (await h.admin.get("/admin/events?limit=2")).json()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ id: "e1", kind: "webhook", ok: true, matchId: MATCH })
    expect(events[1]).toMatchObject({ id: "e2", ok: false, matchId: null })
    expect(typeof events[0].at).toBe("string")
  })
})

describe("mutating routes", () => {
  it("removes a ticket, audits it and emits a queue event", async () => {
    h = await harness()
    const res = await h.admin.post(`/admin/queue/${TICKET}/remove`, { reason: "afk" })
    expect(res.statusCode).toBe(200)
    expect(h.calls.removeTicket).toEqual([TICKET])
    expect(h.store.audit).toHaveLength(1)
    expect(h.store.audit[0]).toMatchObject({
      adminSteamId: ADMIN,
      action: "queue.remove",
      target: TICKET,
      payload: { reason: "afk" },
    })
    expect(h.calls.emitted).toEqual([["queue", { action: "ticket_removed", ticketId: TICKET, by: ADMIN }]])

    const again = await h.admin.post(`/admin/queue/${TICKET}/remove`)
    expect(again.statusCode).toBe(404)
    expect(h.store.audit).toHaveLength(1)
  })

  it("cancels a match with a reason", async () => {
    h = await harness()
    expect((await h.admin.post(`/admin/matches/${MATCH}/cancel`, {})).statusCode).toBe(400)
    expect(h.calls.cancelMatch).toEqual([])

    const res = await h.admin.post(`/admin/matches/${MATCH}/cancel`, { reason: "server crashed" })
    expect(res.statusCode).toBe(200)
    expect(h.calls.cancelMatch).toEqual([[MATCH, "server crashed"]])
    expect(h.store.audit[0]).toMatchObject({ action: "match.cancel", target: MATCH, payload: { reason: "server crashed" } })
    expect(h.calls.emitted[0]?.[0]).toBe("match")

    const gone = await h.admin.post(`/admin/matches/${OLD_MATCH}/cancel`, { reason: "x" })
    expect(gone.statusCode).toBe(404)
    expect(h.store.audit).toHaveLength(1)
  })

  it("bans permanently or until a time and validates input", async () => {
    h = await harness()
    expect((await h.admin.post(`/admin/users/${PLAYER}/ban`, {})).statusCode).toBe(400)
    expect((await h.admin.post(`/admin/users/${PLAYER}/ban`, { reason: "x", until: "2020-01-01T00:00:00Z" })).statusCode).toBe(400)
    expect((await h.admin.post(`/admin/users/${ADMIN}/ban`, { reason: "x" })).statusCode).toBe(400)
    expect((await h.admin.post("/admin/users/not-an-id/ban", { reason: "x" })).statusCode).toBe(404)
    expect(h.calls.ban).toEqual([])

    expect((await h.admin.post(`/admin/users/${PLAYER}/ban`, { reason: "aimbot" })).statusCode).toBe(200)
    const until = "2026-10-01T00:00:00.000Z"
    expect((await h.admin.post(`/admin/users/${OTHER}/ban`, { reason: "toxic", until })).statusCode).toBe(200)
    expect(h.calls.ban).toEqual([
      [PLAYER, "aimbot", null],
      [OTHER, "toxic", new Date(until)],
    ])
    expect(h.store.audit.map((a) => [a.action, a.target, a.payload])).toEqual([
      ["user.ban", PLAYER, { reason: "aimbot", until: null }],
      ["user.ban", OTHER, { reason: "toxic", until }],
    ])
    expect(h.calls.emitted).toEqual([
      ["user", { action: "banned", steamId: PLAYER, until: null, by: ADMIN }],
      ["user", { action: "banned", steamId: OTHER, until, by: ADMIN }],
    ])
  })

  it("bans a player who never signed in by creating a bare user", async () => {
    h = await harness()
    const NEWBIE = "76561198999999999"
    expect((await h.admin.post(`/admin/users/${NEWBIE}/ban`, { reason: "known cheater" })).statusCode).toBe(200)
    expect(h.store.users.get(NEWBIE)?.user.displayName).toBe(NEWBIE)
    expect(h.calls.ban).toEqual([[NEWBIE, "known cheater", null]])
    expect(h.store.audit[0]).toMatchObject({ action: "user.ban", target: NEWBIE, payload: { reason: "known cheater", until: null, createdUser: true } })
  })

  it("unbans and reports 409 when there is no active ban", async () => {
    h = await harness()
    expect((await h.admin.post(`/admin/users/${PLAYER}/unban`)).statusCode).toBe(409)
    expect(h.store.audit).toHaveLength(0)
    await h.admin.post(`/admin/users/${PLAYER}/ban`, { reason: "aimbot" })
    const res = await h.admin.post(`/admin/users/${PLAYER}/unban`)
    expect(res.statusCode).toBe(200)
    expect(h.store.audit.map((a) => a.action)).toEqual(["user.ban", "user.unban"])
    expect(h.calls.emitted.at(-1)).toEqual(["user", { action: "unbanned", steamId: PLAYER, by: ADMIN }])
  })

  it("sets trust level and records the previous level", async () => {
    h = await harness()
    expect((await h.admin.post(`/admin/users/${PLAYER}/trust`, { level: "god" })).statusCode).toBe(400)
    const res = await h.admin.post(`/admin/users/${PLAYER}/trust`, { level: "trusted" })
    expect(res.statusCode).toBe(200)
    expect(res.json().audit).toMatchObject({ action: "user.trust" })
    expect(h.calls.setTrustLevel).toEqual([[PLAYER, "trusted"]])
    expect(h.store.audit[0]?.payload).toEqual({ level: "trusted", before: "new" })
    expect(h.calls.emitted).toEqual([
      ["user", { action: "trust_changed", steamId: PLAYER, level: "trusted", before: "new", by: ADMIN }],
    ])
  })

  it("fails loudly when the audit write fails", async () => {
    h = await harness()
    h.store.failAudit = true
    const res = await h.admin.post(`/admin/users/${PLAYER}/trust`, { level: "trusted" })
    expect(res.statusCode).toBe(500)
  })

  it("clears a cooldown, audits it and pushes the queue status", async () => {
    h = await harness()
    expect((await h.admin.post(`/admin/users/${PLAYER}/cooldown/clear`)).statusCode).toBe(409)
    expect((await h.admin.post("/admin/users/76561198999999999/cooldown/clear")).statusCode).toBe(404)
    expect(h.store.audit).toHaveLength(0)

    const cd = { reason: "abandon", offence: 2, endsAt: new Date(T0.getTime() + 3600_000).toISOString() }
    const expired = { reason: "decline", offence: 1, endsAt: new Date(T0.getTime() - 60_000).toISOString() }
    h.store.users.get(PLAYER)!.cooldowns = [cd, expired]
    const res = await h.admin.post(`/admin/users/${PLAYER}/cooldown/clear`)
    expect(res.statusCode).toBe(200)
    expect(h.store.audit[0]).toMatchObject({ adminSteamId: ADMIN, action: "user.cooldown_clear", target: PLAYER, payload: { cleared: [cd] } })
    expect(h.calls.notified).toEqual([PLAYER])
    expect(h.calls.emitted).toEqual([["user", { action: "cooldown_cleared", steamId: PLAYER, by: ADMIN }]])
    expect((await h.admin.post(`/admin/users/${PLAYER}/cooldown/clear`)).statusCode).toBe(409)
  })
})

describe("user search and state", () => {
  it("searches by name, needs two characters and caps the limit", async () => {
    h = await harness()
    h.store.users.set("76561198000000004", userRecord("76561198000000004", "vexa_two"))
    const res = await h.admin.get("/admin/users?q=VEX")
    expect(res.statusCode).toBe(200)
    expect(res.json().users.map((u: { displayName: string }) => u.displayName)).toEqual(["vexa", "vexa_two"])
    expect(res.json().users[0]).toMatchObject({ steamId: PLAYER, trustLevel: "new", banned: false })
    expect((await h.admin.get("/admin/users?q=vexa")).json().users[0].steamId).toBe(PLAYER)
    expect((await h.admin.get("/admin/users?q=nobody")).json().users).toEqual([])
    expect((await h.admin.get("/admin/users?q=v")).statusCode).toBe(400)
    expect((await h.admin.get("/admin/users")).statusCode).toBe(400)
    expect((await h.admin.get("/admin/users?q=vex&limit=500")).statusCode).toBe(400)
    expect((await h.admin.get("/admin/users?q=vex&limit=1")).json().users).toHaveLength(1)
  })

  it("shows queue and match state and admin names in the log", async () => {
    h = await harness()
    await h.admin.post(`/admin/users/${PLAYER}/trust`, { level: "verified" })
    const u = (await h.admin.get(`/admin/users/${PLAYER}`)).json()
    expect(u.state.queue).toEqual({
      ticketId: TICKET,
      partyId: "55555555-5555-4555-8555-555555555555",
      modes: ["aim1v1", "aim2v2"],
      enqueuedAt: new Date(T0.getTime() - 90_000).toISOString(),
    })
    expect(u.state.match).toMatchObject({ id: MATCH, status: "live", mode: "aim1v1" })
    expect(u.audit[0]).toMatchObject({ adminSteamId: ADMIN, adminName: "boss" })

    // The shortcuts reuse the queue and match actions
    expect((await h.admin.post(`/admin/queue/${u.state.queue.ticketId}/remove`, { reason: "stuck" })).statusCode).toBe(200)
    const after = (await h.admin.get(`/admin/users/${PLAYER}`)).json()
    expect(after.state.queue).toBeNull()

    const other = (await h.admin.get(`/admin/users/${ADMIN}`)).json()
    expect(other.state).toEqual({ queue: null, match: null })
  })
})
