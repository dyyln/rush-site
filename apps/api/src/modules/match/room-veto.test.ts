import { RUSH_MID_POOL, RUSH_ROOM_POOL, RUSH_START_POOL, getModeConfig, isValidRushPath, stepAvailable, type Mode, type VetoState, type VetoStatePayload } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { matches, vetoes } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { ROOM_VETO_FORMAT, SERIES_ROOM_VETO_FORMAT } from "./room-veto.js"
import { matchView } from "./routes.js"

describe("rush room veto", () => {
  let h: Harness
  afterEach(async () => {
    await h.close()
  })

  async function setup(flag: "true" | "false") {
    h = await createHarness({ rng: () => 0, env: { RUSH_ROOM_VETO: flag, RUSH1V1_TEST_QUEUE: "true", RUSH2V2_TEST_QUEUE: "true" } })
    await withServers(h)
  }

  async function acceptedRush(mode: Mode = "rush3v3") {
    const ids = await makeUsers(h.db, getModeConfig(mode).teamSize * 2)
    for (const id of ids) await h.ctx.queue.join(id, [mode])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    for (const id of ids) await h.ctx.flow.respond(id, matchId!, true)
    return matchId!
  }

  const load = async (matchId: string) => {
    const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
    return row ? { row, state: row.state as VetoState } : null
  }
  const match = async (matchId: string) => (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!

  // Every member of the acting team votes for the same room
  async function playStep(matchId: string, pick: (s: VetoState) => string = (s) => stepAvailable(s)[0]!) {
    const { state } = (await load(matchId))!
    const team = state.teams[state.steps[state.stepIndex]!.team]
    const room = pick(state)
    for (const id of team.steamIds) await h.ctx.flow.vote(id, matchId, room)
  }

  it("keeps Rush on the plain flow with the flag off", async () => {
    await setup("false")
    const matchId = await acceptedRush()
    expect(await load(matchId)).toBeNull()
    const m = await match(matchId)
    expect(m.mapId).toBe("rush_001")
    expect(m.rushRooms).toBeNull()
    expect(h.agent.started[0]!.rushRooms).toBeUndefined()
  })

  it("runs the room ban and pick, stores the rooms and sends them to the server", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    const first = (await load(matchId))!
    expect(first.row.format).toBe(ROOM_VETO_FORMAT)
    expect([...first.state.pool].sort()).toEqual([...RUSH_ROOM_POOL].sort())
    // 8 mid room steps, then 3 start room bans
    expect(first.state.steps).toHaveLength(11)
    expect(first.state.phases?.map((p) => p.id)).toEqual(["mid", "start"])
    expect((await match(matchId)).status).toBe("veto")
    const sent = h.notifier.ofType("veto_state").map((s) => s.msg.payload as VetoStatePayload)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((p) => p.kind === "rooms")).toBe(true)

    // The participant view after a reload says it is a room veto
    const viewer = first.state.teams[0].steamIds[0]!
    const page = await matchView(h.ctx, matchId, viewer)
    expect(page!.veto!.kind).toBe("rooms")

    for (let i = 0; i < 11; i++) await playStep(matchId)
    const done = (await load(matchId))!.state
    expect(done.done).toBe(true)
    const start = done.available.filter((r) => RUSH_START_POOL.includes(r))
    expect(start).toHaveLength(1)
    const picks = done.history.filter((x) => x.action === "pick").map((x) => Number(x.mapId))

    const m = await match(matchId)
    // T castle, A pick, A pick, last start room, B pick, B pick, CT castle
    expect(m.rushRooms).toEqual([401, picks[0], picks[2], Number(start[0]), picks[3], picks[1], 301])
    expect(isValidRushPath(m.rushRooms!)).toBe(true)
    expect(m.mapId).toBe("rush_001")
    expect(m.status).toBe("starting")
    expect(h.agent.started[0]!.rushRooms).toEqual(m.rushRooms)
    const after = await matchView(h.ctx, matchId, viewer)
    expect(after!.rushRooms).toEqual(m.rushRooms)
  })

  it("takes the majority vote and breaks a tie at random", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    let { state } = (await load(matchId))!
    const [p1, p2, p3] = state.teams[state.steps[0]!.team].steamIds
    await h.ctx.flow.vote(p1!, matchId, "205")
    await h.ctx.flow.vote(p2!, matchId, "205")
    await h.ctx.flow.vote(p3!, matchId, "201")
    state = (await load(matchId))!.state
    expect(state.history[0]).toMatchObject({ action: "ban", mapId: "205", tieBroken: false })

    const team = state.teams[state.steps[1]!.team].steamIds
    await h.ctx.flow.vote(team[0]!, matchId, "210")
    await h.ctx.flow.vote(team[1]!, matchId, "203")
    await h.ctx.flow.vote(team[2]!, matchId, "202")
    state = (await load(matchId))!.state
    // Three way tie. rng 0 takes the first of the leaders in pool order
    expect(state.history[1]).toMatchObject({ mapId: "202", tieBroken: true })
  })

  it("bans at random when the step timer runs out with no votes", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    h.clock.advance(21_000)
    await h.ctx.flow.timersTick()
    const { state } = (await load(matchId))!
    expect(state.history[0]).toMatchObject({ action: "ban", noVotes: true, mapId: RUSH_MID_POOL[0] })
    expect(state.stepIndex).toBe(1)
  })

  it("replays the room veto on resync", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    const { state } = (await load(matchId))!
    h.notifier.clear()
    await h.ctx.flow.resendState(state.teams[1].steamIds[0]!)
    const replay = h.notifier.ofType("veto_state").map((s) => s.msg.payload as VetoStatePayload)
    expect(replay).toHaveLength(1)
    expect(replay[0]!.kind).toBe("rooms")
  })
  it("refuses a start room during the mid room phase", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    const { state } = (await load(matchId))!
    const voter = state.teams[state.steps[0]!.team].steamIds[0]!
    await expect(h.ctx.flow.vote(voter, matchId, "101")).rejects.toMatchObject({ code: "veto_rejected" })
  })

  it("runs the same veto for the 1v1 Rush test mode", async () => {
    await setup("true")
    const matchId = await acceptedRush("rush1v1")
    const first = (await load(matchId))!
    expect(first.row.format).toBe(ROOM_VETO_FORMAT)
    expect(first.state.teams[0].steamIds).toHaveLength(1)
    // A spread of rooms from the phase pool each step
    for (let i = 0; i < 11; i++) await playStep(matchId, (s) => stepAvailable(s)[(i * 5) % stepAvailable(s).length]!)
    const m = await match(matchId)
    expect(m.mapId).toBe("rush_001")
    expect(isValidRushPath(m.rushRooms!)).toBe(true)
    expect(h.agent.started[0]!.rushRooms).toEqual(m.rushRooms)
  })

  it("runs the same veto for the 2v2 Rush test mode with two voters a side", async () => {
    await setup("true")
    const matchId = await acceptedRush("rush2v2")
    const first = (await load(matchId))!
    expect(first.row.format).toBe(ROOM_VETO_FORMAT)
    expect(first.state.teams.map((t) => t.steamIds.length)).toEqual([2, 2])

    // A split vote waits for the second voter and then breaks the tie
    const [x, y] = first.state.teams[first.state.steps[0]!.team].steamIds as [string, string]
    const [r1, r2] = stepAvailable(first.state) as [string, string]
    await h.ctx.flow.vote(x, matchId, r1)
    expect((await load(matchId))!.state.stepIndex).toBe(0)
    await h.ctx.flow.vote(y, matchId, r2)
    const after = (await load(matchId))!.state
    expect(after.stepIndex).toBe(1)
    expect(after.history[0]).toMatchObject({ tieBroken: true })
    expect([r1, r2]).toContain(after.history[0]!.mapId)

    for (let i = 1; i < 11; i++) await playStep(matchId, (s) => stepAvailable(s)[(i * 5) % stepAvailable(s).length]!)
    const m = await match(matchId)
    expect(m.mapId).toBe("rush_001")
    expect(isValidRushPath(m.rushRooms!)).toBe(true)
    expect(h.agent.started[0]!.rushRooms).toEqual(m.rushRooms)
  })
})

describe("rush series room veto", () => {
  let h: Harness
  afterEach(async () => {
    await h.close()
  })

  async function setup(flag: "true" | "false") {
    h = await createHarness({ rng: () => 0, env: { RUSH_ROOM_VETO: flag } })
    await withServers(h)
  }

  async function bo3(opts: { gameNumber?: number; tournamentId?: string; higherSeed?: 0 | 1 } = {}) {
    const ids = await makeUsers(h.db, 6)
    const { matchId } = await h.ctx.flow.createTournamentMatch({
      mode: "rush3v3",
      teams: [
        { name: "A", steamIds: ids.slice(0, 3) },
        { name: "B", steamIds: ids.slice(3) },
      ],
      source: {
        kind: "tournament",
        tournamentId: opts.tournamentId ?? crypto.randomUUID(),
        bracketMatchId: "r3m0",
        gameNumber: opts.gameNumber ?? 1,
        bestOf: 3,
        ...(opts.gameNumber && opts.gameNumber > 1 ? { priorMaps: [{ mapNumber: 1, winnerTeam: "A", matchId: crypto.randomUUID() }] } : {}),
        ...(opts.higherSeed !== undefined ? { higherSeed: opts.higherSeed } : {}),
      },
    })
    return matchId
  }

  const load = async (matchId: string) => {
    const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
    return row ? { row, state: row.state as VetoState } : null
  }
  const match = async (matchId: string) => (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!

  async function playAll(matchId: string) {
    for (;;) {
      const cur = await load(matchId)
      if (!cur || cur.state.done) return
      const team = cur.state.teams[cur.state.steps[cur.state.stepIndex]!.team]
      const choice = stepAvailable(cur.state)[0]!
      for (const id of team.steamIds) await h.ctx.flow.vote(id, matchId, choice)
    }
  }

  it("leaves a Rush series on Valve's draw with the flag off", async () => {
    await setup("false")
    const matchId = await bo3()
    expect(await load(matchId)).toBeNull()
    expect((await match(matchId)).seriesRooms).toBeNull()
  })

  it("picks rooms and sides for all three maps and sends them per map to the server", async () => {
    await setup("true")
    const matchId = await bo3({ higherSeed: 1 })
    const first = (await load(matchId))!
    expect(first.row.format).toBe(SERIES_ROOM_VETO_FORMAT)
    expect(first.state.steps).toHaveLength(15)
    // The other team chooses map 1 sides, the higher seed picks the first mid room
    expect(first.state.steps[0]).toMatchObject({ action: "side", team: 0 })
    expect(first.state.steps[1]).toMatchObject({ action: "pick", team: 1 })
    const viewer = first.state.teams[0].steamIds[0]!
    expect((await matchView(h.ctx, matchId, viewer))!.veto!.kind).toBe("series-rooms")
    const sent = h.notifier.ofType("veto_state").map((s) => s.msg.payload as VetoStatePayload)
    expect(sent.every((p) => p.kind === "series-rooms")).toBe(true)

    await playAll(matchId)
    const m = await match(matchId)
    expect(m.status).toBe("starting")
    expect(m.maps).toEqual(["rush_001", "rush_001", "rush_001"])
    expect(m.seriesRooms).toHaveLength(3)
    // Team A took CT first on map 1, map 2 swaps
    expect(m.seriesRooms!.map((r) => r.ctTeam)).toEqual(["A", "B", expect.any(String)])
    const mids = m.seriesRooms!.flatMap((r) => [r.rushRooms[1], r.rushRooms[2], r.rushRooms[4], r.rushRooms[5]].map(String))
    expect(new Set(mids)).toEqual(new Set(RUSH_MID_POOL))
    for (const r of m.seriesRooms!) expect(isValidRushPath(r.rushRooms)).toBe(true)

    const req = h.agent.started.at(-1)!
    expect(req.rushRooms).toBeUndefined()
    expect(req.series!.maps.map((x) => x.rushRooms)).toEqual(m.seriesRooms!.map((r) => r.rushRooms))
    expect(req.series!.maps.map((x) => x.ctTeam)).toEqual(m.seriesRooms!.map((r) => r.ctTeam))
    const page = await matchView(h.ctx, matchId, viewer)
    expect(page!.maps!.map((x) => x.ctTeam)).toEqual(m.seriesRooms!.map((r) => r.ctTeam))
    expect(page!.maps!.map((x) => x.rushRooms)).toEqual(m.seriesRooms!.map((r) => r.rushRooms))
  })

  it("a resumed series keeps the rooms its first match picked", async () => {
    await setup("true")
    const tournamentId = crypto.randomUUID()
    const firstId = await bo3({ tournamentId })
    await playAll(firstId)
    const rooms = (await match(firstId)).seriesRooms
    await h.ctx.flow.cancelMatch(firstId, "server_crashed", { requeue: false })
    const resumed = await bo3({ tournamentId, gameNumber: 2 })
    expect(await load(resumed)).toBeNull()
    expect((await match(resumed)).seriesRooms).toEqual(rooms)
    expect(h.agent.started.at(-1)!.series!.maps[1]!.rushRooms).toEqual(rooms![1]!.rushRooms)
  })
})
