import { describe, expect, it } from "vitest"
import { RUSH_MID_POOL, RUSH_ROOM_VETO, RUSH_START_POOL, type RoomVetoFormat } from "../config/rush-veto.js"
import type { VetoState, VetoTeam } from "../schemas/veto.js"
import { castVote, resolveStep, stepAvailable, vote } from "./bo3.js"
import { createRoomVeto, currentRoomPhase, isValidRushPath, nextPickSlot, roomSlots, roomVetoSteps, rushRoomsFromVeto } from "./rooms.js"

const A1 = "76561198000000001"
const A2 = "76561198000000002"
const B1 = "76561198000000011"
const B2 = "76561198000000012"
const teams: [VetoTeam, VetoTeam] = [
  { id: "A", steamIds: [A1, A2] },
  { id: "B", steamIds: [B1, B2] },
]
const solo: [VetoTeam, VetoTeam] = [
  { id: "A", steamIds: [A1] },
  { id: "B", steamIds: [B1] },
]
const first = () => 0
const format = RUSH_ROOM_VETO.format

// Small seeded rng so the property test is repeatable
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return s / 2 ** 31
  }
}

// Every member of the acting team votes for a room the chooser returns
function playOut(t: [VetoTeam, VetoTeam], f: RoomVetoFormat, choose: (s: VetoState) => string = (s) => stepAvailable(s)[0]!, rng = first) {
  let s = createRoomVeto(t, f)
  while (!s.done) {
    const team = s.teams[s.steps[s.stepIndex]!.team]
    const room = choose(s)
    for (const id of team.steamIds) s = vote(s, id, room, rng)
  }
  return s
}

describe("room veto config", () => {
  it("is off by default", () => {
    expect(RUSH_ROOM_VETO.enabled).toBe(false)
  })

  it("runs mid rooms then the start room from Valve's separate pools", () => {
    expect(format.phases.map((p) => p.id)).toEqual(["mid", "start"])
    expect(format.phases[0]!.pool).toEqual(RUSH_MID_POOL)
    expect(format.phases[1]!.pool).toEqual(RUSH_START_POOL)
    expect(RUSH_MID_POOL).toHaveLength(12)
    expect(RUSH_START_POOL).toHaveLength(4)
  })
})

describe("roomVetoSteps", () => {
  it("runs 8 mid steps then 3 start bans with teams alternating throughout", () => {
    const steps = roomVetoSteps(format)
    expect(steps).toHaveLength(11)
    expect(steps.slice(0, 8).map((s) => s.action)).toEqual(["ban", "ban", "pick", "pick", "ban", "ban", "pick", "pick"])
    expect(steps.slice(0, 8).every((s) => s.phase === 0)).toBe(true)
    expect(steps.slice(8).map((s) => [s.action, s.phase])).toEqual([
      ["ban", 1],
      ["ban", 1],
      ["ban", 1],
    ])
    steps.forEach((s, i) => expect(s.team).toBe(i % 2))
  })

  it("gives each team two mid picks", () => {
    const steps = roomVetoSteps(format)
    expect(steps.filter((s) => s.action === "pick" && s.team === 0)).toHaveLength(2)
    expect(steps.filter((s) => s.action === "pick" && s.team === 1)).toHaveLength(2)
  })

  it("starts with the given team", () => {
    expect(roomVetoSteps(format, 1)[0]!.team).toBe(1)
  })

  it("rejects more picks than slots", () => {
    const bad = { phases: [{ ...format.phases[0]!, pickSlots: [[1], [5, 4]] as const }, format.phases[1]!] }
    expect(() => roomVetoSteps(bad)).toThrow()
  })

  it("rejects a phase with more steps than rooms", () => {
    const bad = { phases: [{ ...format.phases[1]!, sequence: ["ban", "ban", "ban", "ban"] as const, banToOne: false }] }
    expect(() => roomVetoSteps(bad)).toThrow()
  })
})

describe("phases", () => {
  it("only offers the current phase's pool", () => {
    let s = createRoomVeto(teams, format)
    expect(stepAvailable(s)).toEqual([...RUSH_MID_POOL])
    expect(() => castVote(s, A1, "101")).toThrow()
    for (let i = 0; i < 8; i++) s = resolveStep(s, first)
    expect(stepAvailable(s)).toEqual([...RUSH_START_POOL])
    expect(() => castVote(s, s.teams[s.steps[s.stepIndex]!.team].steamIds[0]!, RUSH_MID_POOL[11]!)).toThrow()
  })

  it("reports the running phase", () => {
    let s = createRoomVeto(teams, format)
    expect(currentRoomPhase(s, format)?.phase.label).toBe("Mid rooms")
    for (let i = 0; i < 8; i++) s = resolveStep(s, first)
    expect(currentRoomPhase(s, format)?.phase.label).toBe("Start room")
    for (let i = 0; i < 3; i++) s = resolveStep(s, first)
    expect(currentRoomPhase(s, format)).toBeNull()
  })
})

describe("roomSlots", () => {
  it("starts with only the castles", () => {
    const slots = roomSlots(createRoomVeto(teams, format), format)
    expect(slots.map((s) => s.room)).toEqual(["401", null, null, null, null, null, "301"])
  })

  it("places mid picks next to each team's castle and the last start room in slot 3", () => {
    const s = playOut(teams, format)
    const slots = roomSlots(s, format)
    const picks = s.history.filter((h) => h.action === "pick")
    expect(slots[1]).toMatchObject({ room: picks[0]!.mapId, source: "pick", team: 0 })
    expect(slots[5]).toMatchObject({ room: picks[1]!.mapId, source: "pick", team: 1 })
    expect(slots[2]).toMatchObject({ room: picks[2]!.mapId, team: 0 })
    expect(slots[4]).toMatchObject({ room: picks[3]!.mapId, team: 1 })
    const startLeft = s.available.filter((r) => RUSH_START_POOL.includes(r))
    expect(startLeft).toHaveLength(1)
    expect(slots[3]).toMatchObject({ room: startLeft[0], source: "leftover" })
    // Unpicked mid rooms stay unused
    expect(s.available.filter((r) => RUSH_MID_POOL.includes(r))).toHaveLength(4)
  })

  it("leaves the start slot open until the start phase is over", () => {
    let s = createRoomVeto(teams, format)
    for (let i = 0; i < 10; i++) s = resolveStep(s, first)
    expect(roomSlots(s, format)[3]!.room).toBeNull()
  })

  it("tells where the current pick lands", () => {
    let s = createRoomVeto(teams, format)
    expect(nextPickSlot(s, format)).toBeNull()
    s = resolveStep(resolveStep(s, first), first)
    expect(nextPickSlot(s, format)).toBe(1)
    s = resolveStep(s, first)
    expect(nextPickSlot(s, format)).toBe(5)
  })
})

describe("room votes", () => {
  it("takes the majority and breaks ties at random", () => {
    let s = createRoomVeto(teams, format)
    s = vote(s, A1, "201")
    s = vote(s, A2, "202", () => 0.99)
    expect(s.history[0]).toMatchObject({ tieBroken: true, mapId: "202" })
  })

  it("bans at random when nobody votes before the timer", () => {
    const s = resolveStep(createRoomVeto(teams, format), () => 0)
    expect(s.history[0]).toMatchObject({ noVotes: true, action: "ban", mapId: RUSH_MID_POOL[0] })
  })

  it("works with one player a team", () => {
    const s = playOut(solo, format)
    expect(s.done).toBe(true)
    expect(isValidRushPath(rushRoomsFromVeto(s, format))).toBe(true)
  })
})

describe("server pool rule", () => {
  it("every veto result passes it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seeded(seed)
      const t = seed % 2 === 0 ? teams : solo
      const s = playOut(t, format, (st) => {
        const avail = stepAvailable(st)
        return avail[Math.floor(rng() * avail.length)]!
      }, rng)
      const ids = rushRoomsFromVeto(s, format)
      expect(isValidRushPath(ids)).toBe(true)
      expect(ids[3]! >= 101 && ids[3]! <= 104).toBe(true)
      expect(new Set(ids).size).toBe(7)
    }
  })

  it("rejects paths the server would drop", () => {
    expect(isValidRushPath([401, 201, 202, 101, 203, 204, 301])).toBe(true)
    expect(isValidRushPath([401, 201, 202, 205, 203, 204, 301])).toBe(false)
    expect(isValidRushPath([401, 101, 202, 102, 203, 204, 301])).toBe(false)
    expect(isValidRushPath([401, 201, 201, 101, 203, 204, 301])).toBe(false)
    expect(isValidRushPath([301, 201, 202, 101, 203, 204, 401])).toBe(false)
    expect(isValidRushPath([401, 201, 202, 101, 203, 301])).toBe(false)
  })

  it("throws before the veto is done", () => {
    expect(() => rushRoomsFromVeto(createRoomVeto(teams, format), format)).toThrow()
  })
})
