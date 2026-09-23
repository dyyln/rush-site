import { describe, expect, it } from "vitest"
import { findMatches, teamKind, teamMean, type MmTicket } from "./matchmaker.js"

const NOW = 1_000_000_000
let n = 0
const t = (size: number, rating: number, waitSec = 0, region = "eu"): MmTicket => ({
  id: `t${++n}`,
  size,
  rating,
  enqueuedAt: NOW - waitSec * 1000,
  region,
})
const ids = (team: MmTicket[]) => team.map((x) => x.id).sort()

describe("team helpers", () => {
  it("weights party ratings by size", () => {
    expect(teamMean([t(2, 1600), t(1, 1300)])).toBe(1500)
    expect(teamKind([t(1, 1500), t(1, 1500)])).toBe("solo")
    expect(teamKind([t(2, 1500), t(1, 1500)])).toBe("party")
  })
})

describe("findMatches 1v1", () => {
  it("pairs the closest ratings", () => {
    const a = t(1, 1500, 10)
    const b = t(1, 1800, 5)
    const c = t(1, 1520, 1)
    const out = findMatches([a, b, c], { mode: "aim1v1", teamSize: 1, now: NOW })
    expect(out).toHaveLength(1)
    expect([...ids(out[0]!.teams[0]), ...ids(out[0]!.teams[1])].sort()).toEqual([a.id, c.id].sort())
  })

  it("respects the rating window and widens it with wait time", () => {
    const fresh = [t(1, 1500, 0), t(1, 1650, 0)]
    expect(findMatches(fresh, { mode: "aim1v1", teamSize: 1, now: NOW })).toHaveLength(0)
    const waited = [t(1, 1500, 70), t(1, 1650, 70)]
    expect(findMatches(waited, { mode: "aim1v1", teamSize: 1, now: NOW })).toHaveLength(1)
  })

  it("never matches across regions", () => {
    expect(findMatches([t(1, 1500, 400, "eu"), t(1, 1500, 400, "na")], { mode: "aim1v1", teamSize: 1, now: NOW })).toHaveLength(0)
  })
})

describe("findMatches 2v2 party buckets", () => {
  it("puts duo against duo and solos against solos", () => {
    const duoA = t(2, 1500, 10)
    const duoB = t(2, 1510, 9)
    const s1 = t(1, 1500, 8)
    const s2 = t(1, 1505, 7)
    const s3 = t(1, 1495, 6)
    const s4 = t(1, 1502, 5)
    const out = findMatches([duoA, duoB, s1, s2, s3, s4], { mode: "aim2v2", teamSize: 2, now: NOW })
    expect(out).toHaveLength(2)
    for (const p of out) {
      expect(p.mixed).toBe(false)
      expect(teamKind(p.teams[0])).toBe(teamKind(p.teams[1]))
    }
  })

  it("does not mix a duo with solos before the mix timeout", () => {
    const tickets = [t(2, 1500, 10), t(1, 1500, 10), t(1, 1500, 10)]
    expect(findMatches(tickets, { mode: "aim2v2", teamSize: 2, now: NOW })).toHaveLength(0)
  })

  it("mixes once every ticket has waited long enough", () => {
    const tickets = [t(2, 1500, 61), t(1, 1500, 61), t(1, 1500, 61)]
    const out = findMatches(tickets, { mode: "aim2v2", teamSize: 2, now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0]!.mixed).toBe(true)
  })

  it("prefers an unmixed match when one exists even after the timeout", () => {
    const duoA = t(2, 1500, 100)
    const duoB = t(2, 1540, 90)
    const s1 = t(1, 1500, 95)
    const s2 = t(1, 1500, 95)
    const out = findMatches([duoA, duoB, s1, s2], { mode: "aim2v2", teamSize: 2, now: NOW })
    const withDuoA = out.find((p) => [...p.teams[0], ...p.teams[1]].some((x) => x.id === duoA.id))!
    expect(withDuoA.mixed).toBe(false)
  })
})

describe("findMatches 3v3", () => {
  it("fills a duo with a solo and matches it against a full party", () => {
    const trio = t(3, 1500, 20)
    const duo = t(2, 1500, 20)
    const solo = t(1, 1500, 20)
    const out = findMatches([trio, duo, solo], { mode: "rush3v3", teamSize: 3, now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0]!.mixed).toBe(false)
    const sizes = out[0]!.teams.map((team) => team.reduce((s, x) => s + x.size, 0))
    expect(sizes).toEqual([3, 3])
  })

  it("builds two balanced solo teams from six solos", () => {
    const ratings = [1420, 1460, 1500, 1540, 1580, 1600]
    const out = findMatches(
      ratings.map((r) => t(1, r, 5)),
      { mode: "rush3v3", teamSize: 3, now: NOW },
    )
    expect(out).toHaveLength(1)
    const [a, b] = out[0]!.means
    expect(Math.abs(a - b)).toBeLessThanOrEqual(20)
  })

  it("keeps solo teams away from party teams until the mix timeout", () => {
    const trio = t(3, 1500, 10)
    const solos = [t(1, 1500, 10), t(1, 1500, 10), t(1, 1500, 10)]
    expect(findMatches([trio, ...solos], { mode: "rush3v3", teamSize: 3, now: NOW })).toHaveLength(0)
    const late = [t(3, 1500, 95), t(1, 1500, 95), t(1, 1500, 95), t(1, 1500, 95)]
    expect(findMatches(late, { mode: "rush3v3", teamSize: 3, now: NOW })).toHaveLength(1)
  })
})

describe("findMatches at scale", () => {
  function seeded(seed: number): () => number {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
  }

  function crowd(count: number, teamSize: number, seed: number): MmTicket[] {
    const r = seeded(seed)
    return Array.from({ length: count }, (_, i) => {
      const x = r()
      const size = teamSize === 1 ? 1 : teamSize === 2 ? (x < 0.7 ? 1 : 2) : x < 0.6 ? 1 : x < 0.85 ? 2 : 3
      const rating = 1500 + Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()) * 300
      return { id: `c${i}`, size, rating, enqueuedAt: NOW - Math.floor(r() * 400_000), region: "eu" }
    })
  }

  it.each([
    ["aim1v1", 1],
    ["aim2v2", 2],
    ["rush3v3", 3],
  ] as const)("matches 5,000 %s tickets in under 200 ms", (mode, teamSize) => {
    const tickets = crowd(5000, teamSize, 7)
    findMatches(crowd(500, teamSize, 8), { mode, teamSize, now: NOW })
    let best = Number.POSITIVE_INFINITY
    let proposals = 0
    // Best of five so a busy machine does not fail the run
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      proposals = findMatches(tickets, { mode, teamSize, now: NOW }).length
      best = Math.min(best, performance.now() - t0)
    }
    expect(proposals).toBeGreaterThan(1000)
    expect(best).toBeLessThan(200)
  })
})
