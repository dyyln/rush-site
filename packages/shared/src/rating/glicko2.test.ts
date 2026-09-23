import { describe, expect, it } from "vitest"
import { defaultRating, expectedScore, teamComposite, updateRating, updateTeamMatch } from "./glicko2.js"

describe("updateRating", () => {
  it("matches Glickman's worked example", () => {
    const next = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30 }, score: 1 },
      { opponent: { rating: 1550, rd: 100 }, score: 0 },
      { opponent: { rating: 1700, rd: 300 }, score: 0 },
    ])
    expect(next.rating).toBeCloseTo(1464.06, 1)
    expect(next.rd).toBeCloseTo(151.52, 1)
    expect(next.volatility).toBeCloseTo(0.05999, 4)
  })

  it("grows RD when no games are played and caps it", () => {
    const p = { rating: 1600, rd: 100, volatility: 0.06 }
    const next = updateRating(p, [])
    expect(next.rating).toBe(1600)
    expect(next.rd).toBeGreaterThan(100)
    expect(updateRating(defaultRating(), []).rd).toBe(350)
  })

  it("moves the winner up and the loser down symmetrically for equal players", () => {
    const a = defaultRating()
    const w = updateRating(a, [{ opponent: a, score: 1 }])
    const l = updateRating(a, [{ opponent: a, score: 0 }])
    expect(w.rating).toBeGreaterThan(1500)
    expect(l.rating).toBeLessThan(1500)
    expect(w.rating - 1500).toBeCloseTo(1500 - l.rating, 6)
  })

  it("rewards an upset more than an expected win", () => {
    const p = { rating: 1500, rd: 80, volatility: 0.06 }
    const upset = updateRating(p, [{ opponent: { rating: 1800, rd: 80 }, score: 1 }])
    const expected = updateRating(p, [{ opponent: { rating: 1200, rd: 80 }, score: 1 }])
    expect(upset.rating - 1500).toBeGreaterThan(expected.rating - 1500)
  })

  it("respects minRd", () => {
    const p = { rating: 1500, rd: 31, volatility: 0.001 }
    const next = updateRating(p, [{ opponent: { rating: 1500, rd: 30 }, score: 1 }], { minRd: 30 })
    expect(next.rd).toBeGreaterThanOrEqual(30)
  })
})

describe("expectedScore", () => {
  it("is 0.5 for equal players and favours the higher rating", () => {
    const a = { rating: 1500, rd: 100 }
    expect(expectedScore(a, a)).toBeCloseTo(0.5, 10)
    expect(expectedScore({ rating: 1700, rd: 100 }, a)).toBeGreaterThan(0.5)
  })
})

describe("team matches", () => {
  it("averages team rating and RD", () => {
    const c = teamComposite([
      { rating: 1400, rd: 100, volatility: 0.06 },
      { rating: 1600, rd: 200, volatility: 0.06 },
    ])
    expect(c.rating).toBe(1500)
    expect(c.rd).toBe(150)
  })

  it("updates each player against the opposing mean", () => {
    const teamA = [
      { rating: 1400, rd: 100, volatility: 0.06 },
      { rating: 1600, rd: 200, volatility: 0.06 },
      { rating: 1500, rd: 350, volatility: 0.06 },
    ]
    const teamB = [
      { rating: 1500, rd: 100, volatility: 0.06 },
      { rating: 1500, rd: 100, volatility: 0.06 },
      { rating: 1500, rd: 100, volatility: 0.06 },
    ]
    const [a, b] = updateTeamMatch(teamA, teamB, 1)
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      expect(a[i]!.rating).toBeGreaterThan(teamA[i]!.rating)
      expect(b[i]!.rating).toBeLessThan(teamB[i]!.rating)
    }
    const single = updateRating(teamA[0]!, [{ opponent: teamComposite(teamB), score: 1 }])
    expect(a[0]).toEqual(single)
    // Higher RD moves further
    expect(a[2]!.rating - 1500).toBeGreaterThan(a[1]!.rating - 1600)
  })

  it("rejects invalid scores and empty teams", () => {
    expect(() => updateTeamMatch([defaultRating()], [defaultRating()], 2)).toThrow()
    expect(() => updateTeamMatch([], [defaultRating()], 1)).toThrow()
  })
})
