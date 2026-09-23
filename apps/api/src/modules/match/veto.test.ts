import type { VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { matches, vetoes } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"

describe("veto flow", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
  })
  afterEach(async () => {
    await h.close()
  })

  async function acceptedMatch(mode: "aim1v1" | "aim2v2", size: number) {
    const ids = await makeUsers(h.db, size)
    for (const id of ids) await h.ctx.queue.join(id, [mode])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    for (const id of ids) await h.ctx.flow.respond(id, matchId!, true)
    return matchId!
  }

  const load = async (matchId: string) => {
    const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
    return { row: row!, state: row!.state as VetoState }
  }

  it("runs bo1-ban to one map and hands it to the allocator", async () => {
    const matchId = await acceptedMatch("aim1v1", 2)
    let { state } = await load(matchId)
    expect(state.steps).toHaveLength(5)
    expect(state.steps.every((s) => s.action === "ban")).toBe(true)
    while (!state.done) {
      const voter = state.teams[state.steps[state.stepIndex]!.team].steamIds[0]!
      await h.ctx.flow.vote(voter, matchId, state.available[0]!)
      state = (await load(matchId)).state
    }
    expect(state.maps).toHaveLength(1)
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.mapId).toBe(state.maps[0])
    expect(m!.status).toBe("starting")
    expect(m!.driver).toBe("hetzner")
    expect(h.agent.started).toHaveLength(1)
    const req = h.agent.started[0]!
    expect(req.map.id).toBe(state.maps[0])
    expect(req.cs2.execCfg).toBe("rushsite_aim1v1.cfg")
    expect(req.webhookUrl).toMatch(new RegExp(`/webhooks/match/${matchId}$`))
    expect(req.allowedSteamIds).toHaveLength(2)
    expect(req.gslt).toMatch(/^GSLTTOKEN/)
  })

  it("rejects votes from the team that is not acting", async () => {
    const matchId = await acceptedMatch("aim1v1", 2)
    const { state } = await load(matchId)
    const idle = state.teams[state.steps[0]!.team === 0 ? 1 : 0].steamIds[0]!
    await expect(h.ctx.flow.vote(idle, matchId, state.available[0]!)).rejects.toMatchObject({ code: "veto_rejected" })
  })

  it("auto-bans at random when the step timer runs out", async () => {
    const matchId = await acceptedMatch("aim1v1", 2)
    const before = (await load(matchId)).state
    h.clock.advance(21_000)
    await h.ctx.flow.tick()
    const after = (await load(matchId)).state
    expect(after.stepIndex).toBe(1)
    expect(after.history[0]).toMatchObject({ action: "ban", noVotes: true })
    expect(after.available).toHaveLength(before.available.length - 1)
  })

  it("uses the team majority and waits for every member in 2v2", async () => {
    const matchId = await acceptedMatch("aim2v2", 4)
    const { state } = await load(matchId)
    const team = state.teams[state.steps[0]!.team].steamIds
    const [m1, m2] = [state.available[1]!, state.available[2]!]
    await h.ctx.flow.vote(team[0]!, matchId, m1)
    expect((await load(matchId)).state.stepIndex).toBe(0)
    await h.ctx.flow.vote(team[1]!, matchId, m1)
    const after = (await load(matchId)).state
    expect(after.stepIndex).toBe(1)
    expect(after.history[0]!.mapId).toBe(m1)
    expect(after.available).not.toContain(m1)
    expect(after.available).toContain(m2)
  })

  it("breaks a split vote at random when the timer ends", async () => {
    const matchId = await acceptedMatch("aim2v2", 4)
    const { state } = await load(matchId)
    const team = state.teams[state.steps[0]!.team].steamIds
    await h.ctx.flow.vote(team[0]!, matchId, state.available[3]!)
    await h.ctx.flow.vote(team[1]!, matchId, state.available[4]!)
    const after = (await load(matchId)).state
    expect(after.history[0]!.tieBroken).toBe(true)
    expect([state.available[3], state.available[4]]).toContain(after.history[0]!.mapId)
  })

  it("hides the acting team's votes from the other team", async () => {
    const matchId = await acceptedMatch("aim2v2", 4)
    const { state } = await load(matchId)
    const actingIdx = state.steps[0]!.team
    const acting = state.teams[actingIdx].steamIds
    const other = state.teams[actingIdx === 0 ? 1 : 0].steamIds
    h.notifier.clear()
    await h.ctx.flow.vote(acting[0]!, matchId, state.available[0]!)
    const msgs = h.notifier.ofType("veto_state")
    const toOther = msgs.find((m) => m.audience.kind === "users" && m.audience.steamIds.includes(other[0]!))!
    const toActing = msgs.find((m) => m.audience.kind === "users" && m.audience.steamIds.includes(acting[0]!))!
    expect((toOther.msg.payload as { state: VetoState }).state.votes).toEqual({})
    expect(Object.keys((toActing.msg.payload as { state: VetoState }).state.votes)).toEqual([acting[0]])
  })

  it("skips the veto for rush and allocates the single map", async () => {
    const ids = await makeUsers(h.db, 6)
    for (const id of ids) await h.ctx.queue.join(id, ["rush3v3"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    for (const id of ids) await h.ctx.flow.respond(id, matchId!, true)
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId!))
    expect(m!.status).toBe("starting")
    expect(await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId!))).toHaveLength(0)
    expect(h.agent.started[0]!.mode).toBe("rush3v3")
  })

  it("waits for a slot and cancels with a requeue after the allocation timeout", async () => {
    h.agent.failWith = Object.assign(new Error("boom"), {})
    const matchId = await acceptedMatch("aim1v1", 2)
    const { state } = await load(matchId)
    let s = state
    while (!s.done) {
      await h.ctx.flow.vote(s.teams[s.steps[s.stepIndex]!.team].steamIds[0]!, matchId, s.available[0]!)
      s = (await load(matchId)).state
    }
    let [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("allocating")
    h.clock.advance((h.env.ALLOCATION_TIMEOUT_SEC + 1) * 1000)
    await h.ctx.flow.tick()
    ;[m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("cancelled")
    const players = s.teams.flatMap((t) => t.steamIds)
    for (const id of players) expect((await h.ctx.queue.status(id)).state).toBe("queued")
  })
})
