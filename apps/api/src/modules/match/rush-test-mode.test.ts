import { currentRoomPhase, RUSH_ROOM_VETO, type VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers, withServers } from "../../../test/helpers.js"
import { matches, ratingEvents, ratings, vetoes } from "../../db/schema.js"
import { signBody } from "../../lib/hmac.js"
import { matchmakeAll } from "../queue/loop.js"

describe("1v1 Rush test queue", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  afterEach(async () => {
    await h.close()
  })

  async function setup(env: Record<string, string> = {}) {
    h = await createAppHarness({ rng: () => 0, env })
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  }

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

  async function accepted(): Promise<{ matchId: string; a: string; b: string }> {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await h.ctx.queue.join(a, ["rush1v1"])
    await h.ctx.queue.join(b, ["rush1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now())
    expect(matchId).toBeTruthy()
    await h.ctx.flow.respond(a, matchId!, true)
    await h.ctx.flow.respond(b, matchId!, true)
    return { matchId: matchId!, a, b }
  }

  it("is off by default. Joins are refused and the status hides it", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    await expect(h.ctx.queue.join(a!, ["rush1v1"])).rejects.toMatchObject({ code: "mode_unavailable" })
    const status = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush1v1")).toEqual({ mode: "rush1v1", available: false, reason: "disabled" })
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush3v3").available).toBe(true)
  })

  it("plays Rush with one player a side, stays unrated and has no leaderboard", async () => {
    await setup({ RUSH1V1_TEST_QUEUE: "true", RUSH_ROOM_VETO: "false" })
    const status = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush1v1")).toEqual({ mode: "rush1v1", available: true })

    const { matchId, a, b } = await accepted()
    const started = h.agent.started.at(-1)!
    expect(started.mode).toBe("rush1v1")
    expect(started.cs2).toMatchObject({ gameType: 0, gameMode: 6, execCfg: "rushsite_rush1v1.cfg", mapName: "rush_001" })
    expect(started.teams.map((t) => t.steamIds.length)).toEqual([1, 1])

    await post(matchId, { type: "server_ready" })
    await post(matchId, { type: "player_connected", steamId: a })
    await post(matchId, { type: "player_connected", steamId: b })
    await post(matchId, { type: "match_started" })
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const winner = m!.teams.find((t) => t.steamIds.includes(a))!.name
    const loser = winner === "A" ? "B" : "A"
    const res = await post(matchId, { type: "match_end", winnerTeam: winner, score: { [winner]: 8, [loser]: 3 }, players: [], demoUploaded: false })
    expect(res.statusCode).toBe(200)
    expect((await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status).toBe("finished")

    expect(await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))).toHaveLength(0)
    expect(await h.db.select().from(ratings).where(eq(ratings.mode, "rush1v1"))).toHaveLength(0)

    const page = (await h.app.inject({ method: "GET", url: `/matches/${matchId}` })).json().match
    expect(page).toMatchObject({ mode: "rush1v1", mapId: "rush_001", unrated: true })

    expect((await h.app.inject({ method: "GET", url: "/leaderboard/rush1v1" })).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/rush1v1/distribution" })).statusCode).toBe(404)
    const profile = (await h.app.inject({ method: "GET", url: `/users/${a}/profile` })).json()
    expect(profile.modes.map((x: { mode: string }) => x.mode)).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    expect(profile.recentMatches[0]).toMatchObject({ matchId, mode: "rush1v1", result: "win", ratingDelta: 0, scoreFor: 8, scoreAgainst: 3 })
  })

  it("runs the room veto when it is on", async () => {
    await setup({ RUSH1V1_TEST_QUEUE: "true", RUSH_ROOM_VETO: "true" })
    const { matchId } = await accepted()
    expect((await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status).toBe("veto")
    for (let i = 0; i < 20; i++) {
      const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
      if (row!.done) break
      const state = row!.state as VetoState
      const [voter] = state.teams[state.steps[state.stepIndex]!.team].steamIds
      const pool = currentRoomPhase(state, RUSH_ROOM_VETO.format)!.phase.pool
      await h.ctx.flow.vote(voter!, matchId, state.available.find((r) => pool.includes(r))!)
    }
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("starting")
    expect(m!.rushRooms).toHaveLength(7)
    expect(h.agent.started.at(-1)!.rushRooms).toEqual(m!.rushRooms)
  })
})
