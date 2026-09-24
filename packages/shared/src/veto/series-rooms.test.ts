import { describe, expect, it } from "vitest"
import { RUSH_MID_POOL, RUSH_SERIES_ROOM_VETO, RUSH_START_POOL, sideKey, type SeriesRoomVetoFormat } from "../config/rush-veto.js"
import type { TeamIndex, VetoState, VetoTeam } from "../schemas/veto.js"
import { castVote, stepAvailable, vote, VetoError } from "./bo3.js"
import {
  createSeriesRoomVeto,
  currentSeriesRoomStep,
  seriesNextPickSlot,
  seriesRoomMaps,
  seriesRushRoomsFromVeto,
  validateSeriesRoomFormat,
} from "./series-rooms.js"

const A1 = "76561198000000001"
const A2 = "76561198000000002"
const B1 = "76561198000000011"
const B2 = "76561198000000012"
const teams: [VetoTeam, VetoTeam] = [
  { id: "A", steamIds: [A1, A2] },
  { id: "B", steamIds: [B1, B2] },
]
const format = RUSH_SERIES_ROOM_VETO.format
// rng below 0.5 makes team 0 the flip winner, above makes team 1
const flipTo = (t: TeamIndex) => () => (t === 0 ? 0.1 : 0.9)

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return s / 2 ** 31
  }
}

function playOut(s: VetoState, choose: (s: VetoState) => string = (x) => stepAvailable(x)[0]!, rng = () => 0) {
  while (!s.done) {
    const team = s.teams[s.steps[s.stepIndex]!.team]
    const pick = choose(s)
    for (const id of team.steamIds) s = vote(s, id, pick, rng)
  }
  return s
}

describe("series room veto config", () => {
  it("passes its own checks", () => {
    expect(() => validateSeriesRoomFormat(format)).not.toThrow()
  })

  it("rejects a format that repeats rooms or skips the map 1 side", () => {
    const fourMaps: SeriesRoomVetoFormat = { maps: 4, steps: format.steps }
    expect(() => validateSeriesRoomFormat(fourMaps)).toThrow(VetoError)
    const noSide: SeriesRoomVetoFormat = { maps: 3, steps: format.steps.filter((s) => !(s.map === 1 && s.kind === "side")) }
    expect(() => validateSeriesRoomFormat(noSide)).toThrow(/map 1 needs a side/)
    const shortMap1: SeriesRoomVetoFormat = { maps: 3, steps: format.steps.filter((s, i) => i !== 1) }
    expect(() => validateSeriesRoomFormat(shortMap1)).toThrow(/only the last map/)
  })
})

describe("createSeriesRoomVeto", () => {
  it("resolves roles to teams: seed, other, then the flip", () => {
    const s = createSeriesRoomVeto(teams, format, 0, flipTo(1))
    expect(s.flipWinner).toBe(1)
    expect(s.steps.map((x) => `${x.action}:${x.team}`)).toEqual([
      "side:1",
      "pick:0",
      "pick:1",
      "pick:0",
      "pick:1",
      "pick:1",
      "pick:1",
      "pick:0",
      "pick:1",
      "pick:0",
      "pick:0",
      "side:1",
      "pick:0",
      "pick:0",
      "pick:1",
    ])
  })

  it("offers only the running phase's pool", () => {
    let s = createSeriesRoomVeto(teams, format, 0, flipTo(0))
    expect(stepAvailable(s)).toEqual([sideKey(1, "ct"), sideKey(1, "t")])
    expect(() => castVote(s, B1, RUSH_MID_POOL[0]!)).toThrow(VetoError)
    s = vote(vote(s, B1, sideKey(1, "t")), B2, sideKey(1, "t"))
    expect(stepAvailable(s)).toEqual([...RUSH_MID_POOL])
    expect(currentSeriesRoomStep(s)).toEqual({ mapNumber: 1, kind: "mid", team: 0, action: "pick" })
  })
})

describe("seriesRoomMaps", () => {
  it("puts picks beside the picker's own castle and swaps sides on map 2", () => {
    let s = createSeriesRoomVeto(teams, format, 0, flipTo(0))
    // Team 1 takes T on map 1, so team 0 is CT
    s = vote(vote(s, B1, sideKey(1, "t")), B2, sideKey(1, "t"))
    expect(seriesRoomMaps(s, format).map((m) => m.ctTeam)).toEqual([0, 1, null])
    expect(seriesNextPickSlot(s, format)).toBe(5)
    const picks = ["201", "202", "203", "204"]
    for (const r of picks) s = vote(vote(s, s.teams[s.steps[s.stepIndex]!.team].steamIds[0]!, r), s.teams[s.steps[s.stepIndex]!.team].steamIds[1]!, r)
    const map1 = seriesRoomMaps(s, format)[0]!
    // Team 0 on CT fills 5 then 4, team 1 on T fills 1 then 2
    expect(map1.slots.map((x) => x.room)).toEqual(["401", "202", "204", null, "203", "201", "301"])
    expect(seriesNextPickSlot(s, format)).toBe(3)
  })

  it("gives team B of map 3 its two picks and team A the mid rooms left", () => {
    const s = playOut(createSeriesRoomVeto(teams, format, 0, flipTo(1)))
    const [m1, m2, m3] = seriesRoomMaps(s, format)
    // Side keys come CT first, so the first choice is always CT
    expect(m1!.ctTeam).toBe(1)
    expect(m2!.ctTeam).toBe(0)
    expect(m3!.ctTeam).toBe(1)
    const b = m3!.slots.filter((x) => x.source === "pick" && x.slot !== 3)
    expect(b.every((x) => x.team === 0)).toBe(true)
    // Team 0 plays T on map 3, so its picks sit beside the T castle
    expect(b.map((x) => x.slot)).toEqual([1, 2])
    const left = m3!.slots.filter((x) => x.source === "leftover")
    expect(left.map((x) => x.slot)).toEqual([4, 5])
    expect(left.every((x) => x.team === 1)).toBe(true)
  })
})

describe("seriesRushRoomsFromVeto", () => {
  it("throws until the veto is done", () => {
    expect(() => seriesRushRoomsFromVeto(createSeriesRoomVeto(teams, format), format)).toThrow(VetoError)
  })

  it("plays all 12 mid rooms and 3 start rooms with no repeats, whatever is picked", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seeded(seed)
      const first: TeamIndex = rng() < 0.5 ? 0 : 1
      const s = playOut(
        createSeriesRoomVeto(teams, format, first, rng),
        (x) => {
          const avail = stepAvailable(x)
          return avail[Math.floor(rng() * avail.length)]!
        },
        rng,
      )
      const maps = seriesRushRoomsFromVeto(s, format)
      expect(maps).toHaveLength(3)
      const mids = maps.flatMap((m) => [m.rushRooms[1], m.rushRooms[2], m.rushRooms[4], m.rushRooms[5]].map(String))
      expect(new Set(mids)).toEqual(new Set(RUSH_MID_POOL))
      const starts = maps.map((m) => String(m.rushRooms[3]))
      expect(new Set(starts).size).toBe(3)
      expect(starts.every((r) => RUSH_START_POOL.includes(r))).toBe(true)
      expect(maps[1]!.ctTeam).toBe(maps[0]!.ctTeam === 0 ? 1 : 0)
    }
  })
})
