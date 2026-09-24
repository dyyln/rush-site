import { currentRoomPhase, RUSH_ROOM_VETO, type VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers, withServers } from "../../../test/helpers.js"
import { matches, ratingEvents, ratings, vetoes } from "../../db/schema.js"
import { signBody } from "../../lib/hmac.js"
import { matchmakeAll } from "../queue/loop.js"

describe("2v2 Rush test queue", () => {
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

  // A duo party and two solos fill the two teams
  async function accepted(): Promise<{ matchId: string; ids: string[]; duo: [string, string] }> {
    const ids = await makeUsers(h.db, 4)
    const [leader, member, s1, s2] = ids as [string, string, string, string]
    const party = await h.ctx.parties.ensure(leader)
    await h.ctx.parties.join(member, party.inviteToken)
    await h.ctx.queue.join(leader, ["rush2v2"])
    await h.ctx.queue.join(s1, ["rush2v2"])
    await h.ctx.queue.join(s2, ["rush2v2"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now())
    expect(matchId).toBeTruthy()
    for (const id of ids) await h.ctx.flow.respond(id, matchId!, true)
    return { matchId: matchId!, ids, duo: [leader, member] }
  }

  it("is off by default. Joins are refused and the status hides it", async () => {
    await setup({ RUSH1V1_TEST_QUEUE: "true" })
    const [a] = await makeUsers(h.db, 1)
    await expect(h.ctx.queue.join(a!, ["rush2v2"])).rejects.toMatchObject({ code: "mode_unavailable" })
    const status = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush2v2")).toEqual({ mode: "rush2v2", available: false, reason: "disabled" })
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush1v1").available).toBe(true)
  })

  it("plays Rush with two players a side, stays unrated and has no leaderboard", async () => {
    await setup({ RUSH2V2_TEST_QUEUE: "true", RUSH_ROOM_VETO: "false" })
    const status = (await h.app.inject({ method: "GET", url: "/status" })).json()
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush2v2")).toEqual({ mode: "rush2v2", available: true })
    expect(status.modes.find((m: { mode: string }) => m.mode === "rush1v1").reason).toBe("disabled")

    const { matchId, ids, duo } = await accepted()
    const started = h.agent.started.at(-1)!
    expect(started.mode).toBe("rush2v2")
    expect(started.cs2).toMatchObject({ gameType: 0, gameMode: 6, execCfg: "rushsite_rush2v2.cfg", mapName: "rush_001" })
    expect(started.teams.map((t) => t.steamIds.length)).toEqual([2, 2])
    // The duo stays together
    expect(started.teams.some((t) => duo.every((id) => t.steamIds.includes(id)))).toBe(true)

    await post(matchId, { type: "server_ready" })
    for (const id of ids) await post(matchId, { type: "player_connected", steamId: id })
    await post(matchId, { type: "match_started" })
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const winner = m!.teams.find((t) => t.steamIds.includes(duo[0]))!.name
    const loser = winner === "A" ? "B" : "A"
    const res = await post(matchId, { type: "match_end", winnerTeam: winner, score: { [winner]: 8, [loser]: 5 }, players: [], demoUploaded: false })
    expect(res.statusCode).toBe(200)
    expect((await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status).toBe("finished")

    expect(await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))).toHaveLength(0)
    expect(await h.db.select().from(ratings).where(eq(ratings.mode, "rush2v2"))).toHaveLength(0)

    const page = (await h.app.inject({ method: "GET", url: `/matches/${matchId}` })).json().match
    expect(page).toMatchObject({ mode: "rush2v2", mapId: "rush_001", unrated: true })

    expect((await h.app.inject({ method: "GET", url: "/leaderboard/rush2v2" })).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/leaderboard/rush2v2/distribution" })).statusCode).toBe(404)
    const profile = (await h.app.inject({ method: "GET", url: `/users/${duo[0]}/profile` })).json()
    expect(profile.modes.map((x: { mode: string }) => x.mode)).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    expect(profile.recentMatches[0]).toMatchObject({ matchId, mode: "rush2v2", result: "win", ratingDelta: 0, scoreFor: 8, scoreAgainst: 5 })
  })

  it("refuses a party of three", async () => {
    await setup({ RUSH2V2_TEST_QUEUE: "true" })
    const [leader, m1, m2] = (await makeUsers(h.db, 3)) as [string, string, string]
    const party = await h.ctx.parties.ensure(leader)
    await h.ctx.parties.join(m1, party.inviteToken)
    await h.ctx.parties.join(m2, party.inviteToken)
    await expect(h.ctx.queue.join(leader, ["rush2v2"])).rejects.toMatchObject({ statusCode: 400, code: "party_too_large" })
  })

  it("runs the room veto with both players of the acting team voting", async () => {
    await setup({ RUSH2V2_TEST_QUEUE: "true", RUSH_ROOM_VETO: "true" })
    const { matchId } = await accepted()
    expect((await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.status).toBe("veto")
    for (let i = 0; i < 20; i++) {
      const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
      if (row!.done) break
      const state = row!.state as VetoState
      const voters = state.teams[state.steps[state.stepIndex]!.team].steamIds
      expect(voters).toHaveLength(2)
      const room = state.available.find((r) => currentRoomPhase(state, RUSH_ROOM_VETO.format)!.phase.pool.includes(r))!
      await h.ctx.flow.vote(voters[0]!, matchId, room)
      // One of two votes does not settle the step
      const [mid] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
      expect((mid!.state as VetoState).stepIndex).toBe(state.stepIndex)
      await h.ctx.flow.vote(voters[1]!, matchId, room)
    }
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("starting")
    expect(m!.rushRooms).toHaveLength(7)
    expect(h.agent.started.at(-1)!.rushRooms).toEqual(m!.rushRooms)
  })
})
