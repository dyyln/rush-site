import { describe, expect, it } from "vitest"
import { RUSH_ROOM_POOL, RUSH_ROOM_VETO, type RoomVetoFormat } from "../config/rush-veto.js"
import type { VetoTeam } from "../schemas/veto.js"
import { resolveStep, vote } from "./bo3.js"
import { createRoomVeto, nextPickSlot, roomSlots, roomVetoSteps, rushRoomsFromVeto } from "./rooms.js"

const A1 = "76561198000000001"
const A2 = "76561198000000002"
const B1 = "76561198000000011"
const B2 = "76561198000000012"
const teams: [VetoTeam, VetoTeam] = [
  { id: "A", steamIds: [A1, A2] },
  { id: "B", steamIds: [B1, B2] },
]
const first = () => 0
const format = RUSH_ROOM_VETO.format

// Every member of the acting team votes for the first available room
function playOut(format: RoomVetoFormat) {
  let s = createRoomVeto(teams, format)
  while (!s.done) {
    const team = s.teams[s.steps[s.stepIndex]!.team]
    for (const id of team.steamIds) s = vote(s, id, s.available[0]!, first)
  }
  return s
}

describe("room veto config", () => {
  it("is off by default", () => {
    expect(RUSH_ROOM_VETO.enabled).toBe(false)
  })

  it("pools the 4 start and 12 mid rooms, without castles or the decider", () => {
    expect(RUSH_ROOM_POOL).toHaveLength(16)
    expect(RUSH_ROOM_POOL).not.toContain("401")
    expect(RUSH_ROOM_POOL).not.toContain("301")
    expect(RUSH_ROOM_POOL).not.toContain("convoy")
  })
})

describe("roomVetoSteps", () => {
  it("alternates teams and adds bans until one room is left", () => {
    const steps = roomVetoSteps(format)
    // 16 rooms, 4 picks and 1 leftover leaves 11 bans
    expect(steps).toHaveLength(15)
    expect(steps.filter((s) => s.action === "pick")).toHaveLength(4)
    expect(steps.slice(0, 10).map((s) => s.action)).toEqual(["ban", "ban", "pick", "pick", "ban", "ban", "pick", "pick", "ban", "ban"])
    steps.forEach((s, i) => expect(s.team).toBe(i % 2))
  })

  it("gives each team two picks", () => {
    const steps = roomVetoSteps(format)
    expect(steps.filter((s) => s.action === "pick" && s.team === 0)).toHaveLength(2)
    expect(steps.filter((s) => s.action === "pick" && s.team === 1)).toHaveLength(2)
  })

  it("keeps the sequence as it is without banToOne", () => {
    expect(roomVetoSteps({ ...format, banToOne: false })).toHaveLength(10)
  })

  it("adds two bans for a 13 room pool", () => {
    expect(roomVetoSteps({ ...format, pool: RUSH_ROOM_POOL.slice(0, 13) })).toHaveLength(12)
  })

  it("starts with the given team", () => {
    expect(roomVetoSteps(format, 1)[0]!.team).toBe(1)
  })

  it("rejects a pool too small for the sequence", () => {
    expect(() => roomVetoSteps({ ...format, pool: RUSH_ROOM_POOL.slice(0, 9) })).toThrow()
  })

  it("rejects more picks than slots", () => {
    expect(() => roomVetoSteps({ ...format, pickSlots: [[1], [5, 4]] })).toThrow()
  })
})

describe("roomSlots", () => {
  it("starts with only the castles", () => {
    const slots = roomSlots(createRoomVeto(teams, format), format)
    expect(slots.map((s) => s.room)).toEqual(["401", null, null, null, null, null, "301"])
  })

  it("places picks from each team's castle and the leftover in the start slot", () => {
    const s = playOut(format)
    const slots = roomSlots(s, format)
    const picks = s.history.filter((h) => h.action === "pick")
    // A picks first into slot 1 then 2, B into 5 then 4
    expect(slots[1]).toMatchObject({ room: picks[0]!.mapId, source: "pick", team: 0 })
    expect(slots[5]).toMatchObject({ room: picks[1]!.mapId, source: "pick", team: 1 })
    expect(slots[2]).toMatchObject({ room: picks[2]!.mapId, team: 0 })
    expect(slots[4]).toMatchObject({ room: picks[3]!.mapId, team: 1 })
    expect(s.available).toHaveLength(1)
    expect(slots[3]).toMatchObject({ room: s.available[0], source: "leftover" })
    expect(slots.every((x) => x.room !== null)).toBe(true)
  })

  it("tells where the current pick lands", () => {
    let s = createRoomVeto(teams, format)
    expect(nextPickSlot(s, format)).toBeNull()
    s = resolveStep(resolveStep(s, first), first)
    expect(nextPickSlot(s, format)).toBe(1)
    s = resolveStep(s, first)
    expect(nextPickSlot(s, format)).toBe(5)
  })

  it("fills open slots with leftovers when the sequence leaves more rooms", () => {
    const f = { ...format, banToOne: false }
    const s = playOut(f)
    const slots = roomSlots(s, f)
    expect(slots[3]!.source).toBe("leftover")
    expect(slots.every((x) => x.room !== null)).toBe(true)
  })
})

describe("room votes", () => {
  it("takes the majority and breaks ties at random", () => {
    let s = createRoomVeto(teams, format)
    s = vote(s, A1, "201")
    s = vote(s, A2, "202", () => 0.99)
    const h = s.history[0]!
    expect(h.tieBroken).toBe(true)
    expect(h.mapId).toBe("202")
  })

  it("bans at random when nobody votes before the timer", () => {
    const s = resolveStep(createRoomVeto(teams, format), () => 0)
    expect(s.history[0]).toMatchObject({ noVotes: true, action: "ban", mapId: RUSH_ROOM_POOL[0] })
  })
})

describe("rushRoomsFromVeto", () => {
  it("gives seven room ids in slot order", () => {
    const s = playOut(format)
    const rooms = rushRoomsFromVeto(s, format)
    expect(rooms).toHaveLength(7)
    expect(rooms[0]).toBe(401)
    expect(rooms[6]).toBe(301)
    expect(new Set(rooms).size).toBe(7)
  })

  it("throws before the veto is done", () => {
    expect(() => rushRoomsFromVeto(createRoomVeto(teams, format), format)).toThrow()
  })
})
