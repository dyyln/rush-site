import { describe, expect, it } from "vitest"
import { FavouriteWeaponSchema, StreakSchema, computeStreak } from "./index.js"

describe("computeStreak", () => {
  it("is zero with no matches", () => {
    expect(computeStreak([])).toEqual({ current: 0, longest: 0 })
  })

  it("tracks the current and longest win runs", () => {
    expect(computeStreak(["win", "win", "win", "loss", "win", "win"])).toEqual({ current: 2, longest: 3 })
  })

  it("counts abandons as losses and goes negative", () => {
    expect(computeStreak(["win", "loss", "abandoned"])).toEqual({ current: -2, longest: 1 })
  })
})

describe("profile extras schemas", () => {
  it("parses streaks and favourite weapons", () => {
    expect(StreakSchema.parse({ current: -3, longest: 5 })).toEqual({ current: -3, longest: 5 })
    expect(() => StreakSchema.parse({ current: 1, longest: -1 })).toThrow()
    expect(FavouriteWeaponSchema.parse({ weapon: "ak47", kills: 12 })).toEqual({ weapon: "ak47", kills: 12 })
    expect(() => FavouriteWeaponSchema.parse({ weapon: "ak47", kills: 0 })).toThrow()
  })
})
