import { describe, expect, it } from "vitest"
import { TIERS } from "./tiers.js"
import { divisionBands, divisionForRating, divisionNumeral, isTopTier, rankLabel } from "./divisions.js"

const tier = (id: string) => TIERS.find((t) => t.id === id)!

describe("tier divisions", () => {
  it("splits a bounded tier into three equal bands, I lowest", () => {
    expect(divisionBands(tier("gold"))).toEqual([
      { division: 1, numeral: "I", min: 1600, max: 1700 },
      { division: 2, numeral: "II", min: 1700, max: 1800 },
      { division: 3, numeral: "III", min: 1800, max: 1900 },
    ])
  })

  it("gives the floorless bottom tier the width of the tier above, open ended below", () => {
    expect(divisionBands(tier("iron"))).toEqual([
      { division: 1, numeral: "I", min: null, max: 800 },
      { division: 2, numeral: "II", min: 800, max: 900 },
      { division: 3, numeral: "III", min: 900, max: 1000 },
    ])
  })

  it("has no divisions in the top tier", () => {
    const top = TIERS[TIERS.length - 1]!
    expect(isTopTier(top)).toBe(true)
    expect(divisionBands(top)).toEqual([])
    expect(divisionForRating(2486)).toBeNull()
    expect(rankLabel(2486)).toBe("Elite")
  })

  it("covers every tier band with its divisions and no gaps", () => {
    for (const t of TIERS.filter((x) => !isTopTier(x))) {
      const bands = divisionBands(t)
      expect(bands).toHaveLength(3)
      expect(bands[0]!.min).toBe(t.min)
      expect(bands[2]!.max).toBe(t.max)
      for (let k = 1; k < bands.length; k++) expect(bands[k]!.min).toBe(bands[k - 1]!.max)
    }
  })

  it("picks the division at the edges, rounding like the tiers do", () => {
    expect(divisionForRating(1712)).toBe(2)
    expect(divisionForRating(1600)).toBe(1)
    expect(divisionForRating(1699.4)).toBe(1)
    expect(divisionForRating(1699.6)).toBe(2)
    expect(divisionForRating(1899)).toBe(3)
    expect(divisionForRating(0)).toBe(1)
    expect(divisionForRating(999)).toBe(3)
    expect(divisionForRating(1299.6)).toBe(1)
  })

  it("labels ranks with tier and numeral", () => {
    expect(rankLabel(1712)).toBe("Gold II")
    expect(rankLabel(950)).toBe("Iron III")
    expect(rankLabel(2199)).toBe("Platinum III")
    expect(divisionNumeral(3)).toBe("III")
  })
})
