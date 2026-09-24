import { describe, expect, it } from "vitest"
import { MapLoadoutSchema } from "../schemas/mode.js"
import { POOL_MAP_ID_RE } from "../schemas/map-pool.js"
import { createVeto } from "../veto/bo3.js"
import { AIM_MAPS } from "./modes.js"
import { LOADOUT_PRIMARIES, LOADOUT_SECONDARIES, configPool, minPoolSize, parseWorkshopRef, poolMapEntry, slugMapId, vetoMinPool } from "./map-pool.js"

describe("map pool helpers", () => {
  it("needs a Bo3 capable pool in modes with a veto", () => {
    expect(minPoolSize("aim1v1")).toBe(5)
    expect(minPoolSize("aim2v2")).toBe(5)
    expect(minPoolSize("rush3v3")).toBe(1)
    expect(vetoMinPool("bo1-ban")).toBe(2)
  })

  it("the minimum really runs every veto format the mode uses", () => {
    const teams = [
      { id: "a", steamIds: ["1"] },
      { id: "b", steamIds: ["2"] },
    ] as [{ id: string; steamIds: string[] }, { id: string; steamIds: string[] }]
    const pool = AIM_MAPS.slice(0, minPoolSize("aim1v1")).map((m) => m.id)
    expect(() => createVeto({ pool, teams, format: "bo1-ban" })).not.toThrow()
    expect(() => createVeto({ pool, teams, format: "bo3-pickban" })).not.toThrow()
    expect(() => createVeto({ pool: pool.slice(1), teams, format: "bo3-pickban" })).toThrow()
  })

  it("parses Workshop ids and URLs", () => {
    expect(parseWorkshopRef(" 3070290869 ")).toBe("3070290869")
    expect(parseWorkshopRef("https://steamcommunity.com/sharedfiles/filedetails/?id=3070290869")).toBe("3070290869")
    expect(parseWorkshopRef("https://steamcommunity.com/workshop/filedetails/?id=3070290869&searchtext=awp")).toBe("3070290869")
    expect(parseWorkshopRef("https://evil.com/sharedfiles/filedetails/?id=1")).toBeNull()
    expect(parseWorkshopRef("https://steamcommunity.com/id/someone")).toBeNull()
    expect(parseWorkshopRef("awp_india")).toBeNull()
  })

  it("slugs titles into valid map ids", () => {
    expect(slugMapId("AIM Map (Source 2)")).toBe("aim_map_source_2")
    expect(slugMapId("  ***  ")).toBe("")
    expect(POOL_MAP_ID_RE.test(slugMapId("x".repeat(80)))).toBe(true)
  })

  it("seeds from the config and keeps match.json entries plain", () => {
    const pool = configPool()
    expect(pool.map((m) => m.id)).toEqual(AIM_MAPS.map((m) => m.id))
    expect(pool.every((m) => m.modes.length === 2 && POOL_MAP_ID_RE.test(m.id))).toBe(true)
    expect(poolMapEntry(pool[0]!)).toEqual({ id: "aim_map", displayName: "Aim Map", workshopId: "3084291314", mapName: "aim_map" })
  })

  it("offers only weapons the loadout schema accepts", () => {
    for (const w of [...LOADOUT_PRIMARIES, ...LOADOUT_SECONDARIES]) {
      expect(MapLoadoutSchema.safeParse({ primary: { ct: w } }).success).toBe(true)
    }
  })
})
