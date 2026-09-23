import { EventEmitter } from "node:events"
import { eq } from "drizzle-orm"
import pino from "pino"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, startDuel, withServers } from "../../../test/helpers.js"
import { matchRounds, matches } from "../../db/schema.js"
import { signBody } from "../../lib/hmac.js"
import { LocalHub, MAX_MATCH_SUBSCRIPTIONS } from "../ws/hub.js"
import { attachSocket } from "../ws/routes.js"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  received: { type: string; payload: any }[] = []
  send(data: string) {
    this.received.push(JSON.parse(data))
  }
  ping() {}
  terminate() {}
  message(obj: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(obj)))
  }
  of(type: string) {
    return this.received.filter((m) => m.type === type)
  }
}

describe("match pages", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  let hub: LocalHub
  const sockets: FakeSocket[] = []

  beforeAll(async () => {
    h = await createAppHarness({ rng: () => 0 })
    hub = new LocalHub()
    // Deliver everything the services publish to the local sockets, like the Redis fan-out does
    const record = h.notifier.send.bind(h.notifier)
    h.notifier.send = (audience, msg) => {
      record(audience, msg)
      hub.deliver(audience, JSON.parse(JSON.stringify(msg)))
    }
  })
  afterAll(async () => {
    for (const s of sockets) s.emit("close")
    await h.close()
  })
  beforeEach(async () => {
    await createTestDb()
    await h.redis.flushall()
    h.notifier.clear()
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  })

  async function post(matchId: string, event: unknown) {
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const payload = JSON.stringify({ event })
    return h.app.inject({
      method: "POST",
      url: `/webhooks/match/${matchId}`,
      payload,
      headers: { "content-type": "application/json", "x-rushsite-signature": signBody(payload, m!.webhookSecret) },
    })
  }

  function spectator(steamId: string | null = null): FakeSocket {
    const s = new FakeSocket()
    sockets.push(s)
    attachSocket(h.ctx, hub, s, steamId, pino({ level: "silent" }))
    return s
  }

  it("stores every round and serves the public shape", async () => {
    const { matchId, a } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "match_started" })
    await post(matchId, { type: "round_end", round: 1, winnerTeam: "A", score: { A: 1, B: 0 }, arena: "arena_01" })
    await post(matchId, { type: "round_end", round: 2, winnerTeam: "draw", score: { A: 1, B: 0 } })
    await post(matchId, { type: "round_end", round: 2, winnerTeam: "B", score: { A: 1, B: 1 } })

    const rows = await h.db.select().from(matchRounds).where(eq(matchRounds.matchId, matchId))
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.round === 1)).toMatchObject({ winnerTeam: "A", arena: "arena_01" })
    expect(rows.every((r) => r.endedAt instanceof Date)).toBe(true)

    const res = await h.app.inject({ method: "GET", url: `/matches/${matchId}` })
    expect(res.statusCode).toBe(200)
    const { match } = res.json()
    expect(match).toMatchObject({ id: matchId, mode: "aim1v1", status: "live", driver: "hetzner" })
    expect(match.startedAt).toBeTruthy()
    expect(match.teams.map((t: { name: string; score: number }) => [t.name, t.score])).toEqual([
      ["A", 1],
      ["B", 1],
    ])
    const player = match.teams.flatMap((t: { players: unknown[] }) => t.players).find((p: { steamId: string }) => p.steamId === a)
    expect(player).toMatchObject({ rating: 1500, tier: "silver", kills: null })
    expect(match.rounds).toHaveLength(2)
    expect(match.rounds[0]).toMatchObject({ round: 1, winnerTeam: "A", score: { A: 1, B: 0 }, arena: "arena_01" })
    expect(match.tournament).toBeUndefined()
    expect(match.connect).toBeUndefined()
  })

  it("shows connect info to participants only", async () => {
    const { matchId, a } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const sid = h.app.signCookie(await h.ctx.sessions.create(a))
    const mine = (await h.app.inject({ method: "GET", url: `/matches/${matchId}`, cookies: { rs_sid: sid } })).json()
    expect(mine.match.connect).toEqual({ ip: "10.0.0.1", port: m!.serverPort, password: m!.password, connect: m!.connect })
    const [outsider] = await (await import("../../../test/helpers.js")).makeUsers(h.db, 1)
    const osid = h.app.signCookie(await h.ctx.sessions.create(outsider!))
    const theirs = (await h.app.inject({ method: "GET", url: `/matches/${matchId}`, cookies: { rs_sid: osid } })).json()
    expect(theirs.match.connect).toBeUndefined()
    expect((await h.app.inject({ method: "GET", url: "/matches/not-a-uuid" })).statusCode).toBe(404)
  })

  it("includes the tournament link for bracket games", async () => {
    const { matchId } = await startDuel(h)
    const { tournaments } = await import("../../db/schema.js")
    const [t] = await h.db
      .insert(tournaments)
      .values({
        cupKey: "daily-aim1v1",
        name: "Daily Aim Cup",
        mode: "aim1v1",
        cadence: "daily",
        maxEntrants: 32,
        minTrust: "verified",
        format: {},
        registrationOpensAt: new Date(),
        startsAt: new Date(),
      })
      .returning()
    await h.db
      .update(matches)
      .set({ tournamentId: t!.id, bracketMatchKey: "r1m0", bestOf: 3, gameNumber: 2 })
      .where(eq(matches.id, matchId))
    const { match } = (await h.app.inject({ method: "GET", url: `/matches/${matchId}` })).json()
    expect(match.tournament).toEqual({ id: t!.id, name: "Daily Aim Cup", bracketMatchId: "r1m0", bestOf: 3, gameNumber: 2 })
  })

  it("fans match_update out to subscribers only, signed in or not", async () => {
    const { matchId } = await startDuel(h)
    const watcher = spectator()
    const bystander = spectator()
    const leaver = spectator()
    watcher.message({ type: "subscribe_match", payload: { matchId } })
    leaver.message({ type: "subscribe_match", payload: { matchId } })
    leaver.message({ type: "unsubscribe_match", payload: { matchId } })

    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "match_started" })
    await post(matchId, { type: "round_end", round: 1, winnerTeam: "B", score: { A: 0, B: 1 } })
    await post(matchId, { type: "match_end", winnerTeam: "B", score: { A: 3, B: 16 }, players: [], demoUploaded: false })

    const updates = watcher.of("match_update")
    expect(updates.map((u) => u.payload.status)).toEqual(["live", "live", "finished"])
    expect(updates[1]!.payload).toMatchObject({
      matchId,
      teams: [
        { name: "A", score: 0 },
        { name: "B", score: 1 },
      ],
      lastRound: { round: 1, winnerTeam: "B", score: { A: 0, B: 1 } },
    })
    expect(updates[2]!.payload.teams).toEqual([
      { name: "A", score: 3 },
      { name: "B", score: 16 },
    ])
    expect(bystander.of("match_update")).toHaveLength(0)
    expect(leaver.of("match_update")).toHaveLength(0)
  })

  it("sends match_update on cancel", async () => {
    const { matchId } = await startDuel(h)
    const watcher = spectator()
    watcher.message({ type: "subscribe_match", payload: { matchId } })
    await post(matchId, { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [] })
    expect(watcher.of("match_update").map((u) => u.payload.status)).toEqual(["cancelled"])
  })

  it("caps subscriptions per socket and keeps spectators read only", async () => {
    const s = spectator()
    for (let i = 0; i < MAX_MATCH_SUBSCRIPTIONS + 1; i++) {
      s.message({ type: "subscribe_match", payload: { matchId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` } })
    }
    expect(s.of("error").map((e) => e.payload.code)).toEqual(["too_many_subscriptions"])
    s.message({ type: "queue_join", payload: { modes: ["aim1v1"] }, ts: Date.now() })
    expect(s.of("error").at(-1)!.payload.code).toBe("unauthorized")
  })
})
