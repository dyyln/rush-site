import { RUSH_ROOM_POOL, type VetoState, type VetoStatePayload } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { matches, vetoes } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { ROOM_VETO_FORMAT } from "./room-veto.js"
import { matchView } from "./routes.js"

describe("rush room veto", () => {
  let h: Harness
  afterEach(async () => {
    await h.close()
  })

  async function setup(flag: "true" | "false") {
    h = await createHarness({ rng: () => 0, env: { RUSH_ROOM_VETO: flag } })
    await withServers(h)
  }

  async function acceptedRush() {
    const ids = await makeUsers(h.db, 6)
    for (const id of ids) await h.ctx.queue.join(id, ["rush3v3"])
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
  async function playStep(matchId: string, pick: (s: VetoState) => string = (s) => s.available[0]!) {
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
    expect(first.state.pool).toEqual([...RUSH_ROOM_POOL])
    expect(first.state.steps).toHaveLength(15)
    expect((await match(matchId)).status).toBe("veto")
    const sent = h.notifier.ofType("veto_state").map((s) => s.msg.payload as VetoStatePayload)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((p) => p.kind === "rooms")).toBe(true)

    // The participant view after a reload says it is a room veto
    const viewer = first.state.teams[0].steamIds[0]!
    const page = await matchView(h.ctx, matchId, viewer)
    expect(page!.veto!.kind).toBe("rooms")

    for (let i = 0; i < 15; i++) await playStep(matchId)
    const done = (await load(matchId))!.state
    expect(done.done).toBe(true)
    expect(done.available).toHaveLength(1)
    const picks = done.history.filter((x) => x.action === "pick").map((x) => Number(x.mapId))

    const m = await match(matchId)
    // T castle, A pick, A pick, leftover start, B pick, B pick, CT castle
    expect(m.rushRooms).toEqual([401, picks[0], picks[2], Number(done.available[0]), picks[3], picks[1], 301])
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
    await h.ctx.flow.vote(p3!, matchId, "101")
    state = (await load(matchId))!.state
    expect(state.history[0]).toMatchObject({ action: "ban", mapId: "205", tieBroken: false })

    const team = state.teams[state.steps[1]!.team].steamIds
    await h.ctx.flow.vote(team[0]!, matchId, "210")
    await h.ctx.flow.vote(team[1]!, matchId, "103")
    await h.ctx.flow.vote(team[2]!, matchId, "202")
    state = (await load(matchId))!.state
    // Three way tie. rng 0 takes the first of the leaders in pool order
    expect(state.history[1]).toMatchObject({ mapId: "103", tieBroken: true })
  })

  it("bans at random when the step timer runs out with no votes", async () => {
    await setup("true")
    const matchId = await acceptedRush()
    h.clock.advance(21_000)
    await h.ctx.flow.timersTick()
    const { state } = (await load(matchId))!
    expect(state.history[0]).toMatchObject({ action: "ban", noVotes: true, mapId: RUSH_ROOM_POOL[0] })
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
})
