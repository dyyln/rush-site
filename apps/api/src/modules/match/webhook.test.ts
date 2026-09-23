import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, startDuel, withServers } from "../../../test/helpers.js"
import { cooldowns, matches, ratingEvents } from "../../db/schema.js"
import { signBody, verifySignature } from "../../lib/hmac.js"

describe("webhook signature", () => {
  const secret = "s".repeat(32)
  const body = JSON.stringify({ event: { type: "server_ready" } })

  it("accepts a correct sha256 hmac", () => {
    expect(verifySignature(body, secret, signBody(body, secret))).toBe(true)
  })

  it("rejects a wrong secret, a changed body and malformed headers", () => {
    expect(verifySignature(body, "t".repeat(32), signBody(body, secret))).toBe(false)
    expect(verifySignature(body + " ", secret, signBody(body, secret))).toBe(false)
    expect(verifySignature(body, secret, undefined)).toBe(false)
    expect(verifySignature(body, secret, "sha1=abc")).toBe(false)
    expect(verifySignature(body, secret, "sha256=zz")).toBe(false)
  })
})

describe("POST /webhooks/match/:matchId", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  beforeAll(async () => {
    h = await createAppHarness({ rng: () => 0 })
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    const { createTestDb } = await import("../../../test/helpers.js")
    await createTestDb()
    await h.redis.flushall()
    h.notifier.clear()
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  })

  const secretOf = async (matchId: string) =>
    (await h.db.select({ s: matches.webhookSecret }).from(matches).where(eq(matches.id, matchId)))[0]!.s

  async function post(matchId: string, event: unknown, secret?: string) {
    const payload = JSON.stringify({ event })
    return h.app.inject({
      method: "POST",
      url: `/webhooks/match/${matchId}`,
      payload,
      headers: {
        "content-type": "application/json",
        "x-rushsite-signature": signBody(payload, secret ?? (await secretOf(matchId))),
      },
    })
  }

  const status = async (matchId: string) =>
    (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!

  const teamOf = async (matchId: string, steamId: string) =>
    (await status(matchId)).teams.find((t) => t.steamIds.includes(steamId))!.name

  it("rejects a bad signature and unknown matches", async () => {
    const { matchId } = await startDuel(h)
    const res = await post(matchId, { type: "server_ready" }, "wrong-secret-wrong-secret-wrong!!")
    expect(res.statusCode).toBe(401)
    expect((await status(matchId)).status).toBe("starting")
    const missing = await post("00000000-0000-4000-8000-000000000000", { type: "server_ready" }, "x".repeat(32))
    expect(missing.statusCode).toBe(404)
  })

  it("server_ready shares the connect string with the password", async () => {
    const { matchId, a } = await startDuel(h)
    const res = await post(matchId, { type: "server_ready" })
    expect(res.statusCode).toBe(200)
    const m = await status(matchId)
    expect(m.status).toBe("ready")
    const msg = h.notifier.ofType("server_ready").find((x) => x.audience.kind === "users" && x.audience.steamIds.includes(a))
    expect((msg!.msg.payload as { connect: string }).connect).toContain(`password ${m.password}`)
  })

  it("rejects an invalid event body", async () => {
    const { matchId } = await startDuel(h)
    const res = await post(matchId, { type: "nope" })
    expect(res.statusCode).toBe(400)
  })

  it("match_end finishes the match, rates it once and ignores later events", async () => {
    const { matchId, a, b } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "player_connected", steamId: a })
    await post(matchId, { type: "player_connected", steamId: b })
    await post(matchId, { type: "match_started" })
    expect((await status(matchId)).status).toBe("live")
    const winner = await teamOf(matchId, a)
    await post(matchId, { type: "round_end", round: 1, winnerTeam: winner, score: { A: 1, B: 0 } })
    const end = {
      type: "match_end",
      winnerTeam: winner,
      score: { [winner]: 16, [winner === "A" ? "B" : "A"]: 9 },
      players: [
        { steamId: a, kills: 30, deaths: 12, headshots: 18, damage: 3100 },
        { steamId: b, kills: 12, deaths: 30, headshots: 4, damage: 1500 },
      ],
      demoUploaded: true,
    }
    expect((await post(matchId, end)).statusCode).toBe(200)
    const m = await status(matchId)
    expect(m.status).toBe("finished")
    expect(m.winnerTeam).toBe(winner)
    const events = await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.steamId === a)!.ratingAfter).toBeGreaterThan(1500)
    const result = h.notifier.ofType("match_result")
    expect(result).toHaveLength(1)
    expect(result[0]!.msg.payload).toMatchObject({ matchId, status: "completed", winnerTeam: winner })
    const profile = (await h.app.inject({ method: "GET", url: `/users/${a}/profile` })).json()
    expect(profile.user).toMatchObject({ steamId: a, trustLevel: "new", region: "eu" })
    const duel = profile.modes.find((x: { mode: string }) => x.mode === "aim1v1")
    expect(duel).toMatchObject({ matches: 1, wins: 1, losses: 0, leaderboardRank: null, kd: 2.5, headshotPct: 0.6 })
    expect(duel.history).toHaveLength(1)
    expect(duel.bestMaps[0]).toMatchObject({ matches: 1, wins: 1 })
    expect(profile.recentMatches[0]).toMatchObject({ matchId, result: "win", scoreFor: 16, scoreAgainst: 9, kills: 30 })
    expect(profile.recentMatches[0].ratingDelta).toBeGreaterThan(0)

    // The server stays up for the demo upload
    expect(h.agent.stopped).not.toContain(matchId)

    expect((await post(matchId, end)).statusCode).toBe(200)
    const crash = await post(matchId, { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [] })
    expect(crash.statusCode).toBe(200)
    expect(await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))).toHaveLength(2)
    expect((await status(matchId)).status).toBe("finished")

    const { demos } = await import("../../db/schema.js")
    let [demo] = await h.db.select().from(demos).where(eq(demos.matchId, matchId))
    expect(demo!.uploaded).toBe(false)
    expect((await post(matchId, { type: "demo_uploaded", ok: true, bytes: 1234 })).statusCode).toBe(200)
    ;[demo] = await h.db.select().from(demos).where(eq(demos.matchId, matchId))
    expect(demo!.uploaded).toBe(true)
    expect(h.agent.stopped).toContain(matchId)
    expect((await status(matchId)).serverReleasedAt).not.toBeNull()
  })

  it("tears the server down after the demo wait when no upload report arrives", async () => {
    const { matchId, a } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "match_end", winnerTeam: await teamOf(matchId, a), score: { A: 16, B: 0 }, players: [], demoUploaded: false })
    await h.ctx.flow.tick()
    expect(h.agent.stopped).not.toContain(matchId)
    h.clock.advance(181_000)
    await h.ctx.flow.tick()
    expect(h.agent.stopped).toContain(matchId)
  })

  it("a drawn match_end leaves ratings alone", async () => {
    const { matchId } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    const res = await post(matchId, { type: "match_end", winnerTeam: "draw", score: { A: 15, B: 15 }, players: [], demoUploaded: false })
    expect(res.statusCode).toBe(200)
    expect((await status(matchId)).status).toBe("finished")
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
  })

  it("a crashed server ends the match with no rating change and no cooldown", async () => {
    const { matchId, a, b } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "match_started" })
    const res = await post(matchId, { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [a, b] })
    expect(res.statusCode).toBe(200)
    expect((await status(matchId)).status).toBe("cancelled")
    expect(h.notifier.ofType("match_cancelled")[0]!.msg.payload).toEqual({ matchId, reason: "server_crashed" })
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
  })

  it("a player who never connects forfeits and gets a cooldown", async () => {
    const { matchId, a, b } = await startDuel(h)
    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "player_connected", steamId: a })
    const res = await post(matchId, { type: "match_abandoned", reason: "no_show", missingSteamIds: [b] })
    expect(res.statusCode).toBe(200)
    const m = await status(matchId)
    expect(m.status).toBe("abandoned")
    expect(m.winnerTeam).toBe(await teamOf(matchId, a))
    const ev = await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))
    expect(ev.find((e) => e.steamId === b)!.reason).toBe("forfeit")
    const cds = await h.db.select().from(cooldowns).where(eq(cooldowns.steamId, b))
    expect(cds[0]!.reason).toBe("no_connect")
    expect(h.notifier.ofType("match_cancelled")[0]!.msg.payload).toEqual({ matchId, reason: "no_show" })
    expect(await h.db.select().from(cooldowns).where(eq(cooldowns.steamId, a))).toHaveLength(0)
  })
})
