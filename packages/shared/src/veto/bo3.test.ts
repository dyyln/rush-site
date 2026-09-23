import { describe, expect, it } from "vitest"
import {
  allVoted,
  banToNSteps,
  bo1Steps,
  bo3Steps,
  stepsForFormat,
  castVote,
  createVeto,
  currentStep,
  resolveStep,
  tallyVotes,
  vetoResult,
  vote,
  VetoError,
} from "./bo3.js"
import type { VetoTeam } from "../schemas/veto.js"

const POOL7 = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]
const A1 = "76561198000000001"
const A2 = "76561198000000002"
const A3 = "76561198000000003"
const B1 = "76561198000000011"
const B2 = "76561198000000012"
const B3 = "76561198000000013"
const teams: [VetoTeam, VetoTeam] = [
  { id: "a", steamIds: [A1, A2, A3] },
  { id: "b", steamIds: [B1, B2, B3] },
]

const first = () => 0
const last = () => 0.999999

describe("bo3Steps", () => {
  it("is ban ban pick pick ban ban alternating from the first team", () => {
    expect(bo3Steps(7)).toEqual([
      { action: "ban", team: 0 },
      { action: "ban", team: 1 },
      { action: "pick", team: 0 },
      { action: "pick", team: 1 },
      { action: "ban", team: 0 },
      { action: "ban", team: 1 },
    ])
    expect(bo3Steps(7, 1)[0]).toEqual({ action: "ban", team: 1 })
  })

  it("drops trailing bans for small pools and rejects tiny pools", () => {
    expect(bo3Steps(6).map((s) => s.action)).toEqual(["ban", "ban", "pick", "pick", "ban"])
    expect(bo3Steps(5)).toHaveLength(4)
    expect(bo3Steps(15)).toHaveLength(6)
    expect(() => bo3Steps(4)).toThrow(VetoError)
  })
})

describe("bo1Steps", () => {
  it("alternates bans until one map remains", () => {
    expect(bo1Steps(6)).toEqual([
      { action: "ban", team: 0 },
      { action: "ban", team: 1 },
      { action: "ban", team: 0 },
      { action: "ban", team: 1 },
      { action: "ban", team: 0 },
    ])
    expect(bo1Steps(3, 1).map((s) => s.team)).toEqual([1, 0])
    expect(() => bo1Steps(1)).toThrow(VetoError)
  })

  it("plays the last remaining map", () => {
    const pool = ["m1", "m2", "m3", "m4", "m5", "m6"]
    let s = createVeto({ pool, teams, format: "bo1-ban" })
    while (!s.done) s = resolveStep(s, first)
    expect(s.maps).toEqual(["m6"])
    expect(vetoResult(s)).toEqual({ picks: [], bans: ["m1", "m2", "m3", "m4", "m5"], deciders: ["m6"] })
  })
})

describe("banToNSteps", () => {
  it("alternates bans until keep maps remain", () => {
    const steps = banToNSteps(15, 7, 1)
    expect(steps).toHaveLength(8)
    expect(steps.every((s) => s.action === "ban")).toBe(true)
    expect(steps.map((s) => s.team)).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
    expect(() => banToNSteps(7, 7)).toThrow(VetoError)
    expect(() => banToNSteps(7, 0)).toThrow(VetoError)
  })

  it("leaves the remaining maps in pool order as deciders", () => {
    const pool = Array.from({ length: 15 }, (_, i) => `a${String(i).padStart(2, "0")}`)
    let s = createVeto({ pool, teams, format: "ban-to-7" })
    expect(s.steps).toEqual(stepsForFormat("ban-to-7", 15))
    while (!s.done) s = resolveStep(s, last)
    expect(s.maps).toEqual(pool.slice(0, 7))
    expect(vetoResult(s).picks).toEqual([])
  })
})

describe("no veto", () => {
  it("is done at once and plays the pool", () => {
    expect(stepsForFormat("none", 1)).toEqual([])
    const s = createVeto({ pool: ["rush_001"], teams, format: "none" })
    expect(s.done).toBe(true)
    expect(s.maps).toEqual(["rush_001"])
    expect(currentStep(s)).toBeNull()
    expect(() => castVote(s, A1, "rush_001")).toThrow(VetoError)
    expect(vetoResult(s).deciders).toEqual(["rush_001"])
    expect(() => createVeto({ pool: [], teams, format: "none" })).toThrow(VetoError)
  })
})

describe("tallyVotes", () => {
  it("picks the majority", () => {
    const r = tallyVotes({ [A1]: "m2", [A2]: "m2", [A3]: "m3" }, POOL7, first)
    expect(r).toEqual({ mapId: "m2", tieBroken: false, noVotes: false })
  })

  it("breaks ties with the rng", () => {
    const votes = { [A1]: "m2", [A2]: "m5" }
    expect(tallyVotes(votes, POOL7, first).mapId).toBe("m2")
    expect(tallyVotes(votes, POOL7, last).mapId).toBe("m5")
    expect(tallyVotes(votes, POOL7, first).tieBroken).toBe(true)
  })

  it("chooses at random from all available when nobody voted", () => {
    const r = tallyVotes({}, POOL7, last)
    expect(r).toEqual({ mapId: "m7", tieBroken: false, noVotes: true })
  })
})

describe("veto flow", () => {
  it("runs a full seven map veto to a decider", () => {
    let s = createVeto({ pool: POOL7, teams })
    const script: [string[], string][] = [
      [[A1, A2, A3], "m1"],
      [[B1, B2, B3], "m2"],
      [[A1, A2, A3], "m3"],
      [[B1, B2, B3], "m4"],
      [[A1, A2, A3], "m5"],
      [[B1, B2, B3], "m6"],
    ]
    for (const [voters, map] of script) {
      for (const v of voters) s = vote(s, v, map, first)
    }
    expect(s.done).toBe(true)
    expect(s.maps).toEqual(["m3", "m4", "m7"])
    expect(vetoResult(s)).toEqual({ picks: ["m3", "m4"], bans: ["m1", "m2", "m5", "m6"], deciders: ["m7"] })
    expect(currentStep(s)).toBeNull()
  })

  it("only resolves once every acting member has voted", () => {
    let s = createVeto({ pool: POOL7, teams })
    s = vote(s, A1, "m1", first)
    s = vote(s, A2, "m2", first)
    expect(s.stepIndex).toBe(0)
    expect(allVoted(s)).toBe(false)
    s = vote(s, A3, "m2", first)
    expect(s.stepIndex).toBe(1)
    expect(s.available).not.toContain("m2")
    expect(s.history[0]).toMatchObject({ action: "ban", team: 0, mapId: "m2", tieBroken: false })
    expect(s.votes).toEqual({})
  })

  it("lets a player change their vote", () => {
    let s = createVeto({ pool: POOL7, teams })
    s = castVote(s, A1, "m1")
    s = castVote(s, A1, "m4")
    expect(s.votes).toEqual({ [A1]: "m4" })
  })

  it("resolves on timeout with partial or no votes", () => {
    let s = createVeto({ pool: POOL7, teams })
    s = castVote(s, A1, "m6")
    s = resolveStep(s, first)
    expect(s.history[0]!.mapId).toBe("m6")
    s = resolveStep(s, first)
    expect(s.history[1]).toMatchObject({ mapId: "m1", noVotes: true, team: 1 })
  })

  it("rejects invalid votes", () => {
    const s = createVeto({ pool: POOL7, teams })
    expect(() => castVote(s, B1, "m1")).toThrow(VetoError)
    expect(() => castVote(s, A1, "nope")).toThrow(VetoError)
    const s2 = vote(vote(vote(s, A1, "m1", first), A2, "m1", first), A3, "m1", first)
    expect(() => castVote(s2, B1, "m1")).toThrow(VetoError)
  })

  it("rejects bad setups", () => {
    expect(() => createVeto({ pool: ["a", "a", "b", "c", "d"], teams })).toThrow(VetoError)
    expect(() => createVeto({ pool: ["a", "b", "c", "d"], teams })).toThrow(VetoError)
    expect(() =>
      createVeto({ pool: POOL7, teams: [teams[0], { id: "b", steamIds: [A1] }] }),
    ).toThrow(VetoError)
    expect(() => resolveStep({ ...createVeto({ pool: POOL7, teams }), done: true })).toThrow(VetoError)
  })

  it("leaves several deciders for a large pool", () => {
    const pool = Array.from({ length: 15 }, (_, i) => `a${i}`)
    let s = createVeto({ pool, teams: [{ id: "a", steamIds: [A1] }, { id: "b", steamIds: [B1] }] })
    while (!s.done) s = resolveStep(s, first)
    expect(s.maps).toHaveLength(2 + 9)
    expect(vetoResult(s).deciders).toHaveLength(9)
  })

  it("does not mutate the input state", () => {
    const s = createVeto({ pool: POOL7, teams })
    const snapshot = JSON.stringify(s)
    castVote(s, A1, "m1")
    resolveStep(s, first)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})
