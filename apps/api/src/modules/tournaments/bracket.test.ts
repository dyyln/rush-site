import { describe, expect, it } from "vitest"
import {
  type Bracket,
  type BestOfRule,
  BracketError,
  buildBracket,
  cancelGame,
  claimGame,
  releaseGame,
  forfeit,
  isComplete,
  nextPowerOfTwo,
  placements,
  playableMatches,
  recordGame,
  seedEntries,
  seedPositions,
  seriesScore,
  startGame,
  winsNeeded,
} from "./bracket.js"

const RULE: BestOfRule = { default: 1, semis: 1, final: 3 }

function entries(n: number) {
  // e1 has the highest rating.
  return Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, rating: 2000 - i * 10 }))
}

function m(b: Bracket, id: string) {
  const x = b.matches.find((y) => y.id === id)
  if (!x) throw new Error(id)
  return x
}

let gameSeq = 0
function play(b: Bracket, id: string, winner: "a" | "b"): Bracket {
  const gid = `g${++gameSeq}`
  return recordGame(startGame(b, id, gid), id, gid, winner)
}

// Plays every ready match with the higher seed winning until the bracket is done.
function playOut(b: Bracket): Bracket {
  let cur = b
  for (let guard = 0; guard < 500 && !isComplete(cur); guard++) {
    const ready = playableMatches(cur)
    if (ready.length === 0) throw new Error("stuck")
    const r = ready[0]!
    cur = play(cur, r.id, (r.aSeed ?? 99) < (r.bSeed ?? 99) ? "a" : "b")
  }
  return cur
}

describe("seeding", () => {
  it("computes powers of two", () => {
    expect([1, 2, 3, 5, 8, 9, 33].map(nextPowerOfTwo)).toEqual([1, 2, 4, 8, 8, 16, 64])
  })

  it("uses standard seed positions", () => {
    expect(seedPositions(2)).toEqual([1, 2])
    expect(seedPositions(4)).toEqual([1, 4, 2, 3])
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(() => seedPositions(6)).toThrow(BracketError)
  })

  it("puts every seed pair in round one summing to size plus one", () => {
    const p = seedPositions(32)
    for (let i = 0; i < p.length; i += 2) expect(p[i]! + p[i + 1]!).toBe(33)
    expect(new Set(p).size).toBe(32)
  })

  it("sorts by rating then sign-up time then id", () => {
    const s = seedEntries([
      { id: "x", rating: 1500, registeredAt: 2 },
      { id: "y", rating: 1800 },
      { id: "z", rating: 1500, registeredAt: 1 },
      { id: "w", rating: 1500, registeredAt: 1 },
    ])
    expect(s.map((e) => e.id)).toEqual(["y", "w", "z", "x"])
  })

  it("keeps the top two seeds apart until the final", () => {
    const b = buildBracket(entries(8), RULE)
    expect(m(b, "r1m0").a).toBe("e1")
    expect(m(b, "r1m0").b).toBe("e8")
    expect(m(b, "r1m2").a).toBe("e2")
    const done = playOut(b)
    const final = m(done, "r3m0")
    expect([final.a, final.b]).toEqual(["e1", "e2"])
  })

  it("rejects fewer than two entries and duplicates", () => {
    expect(() => buildBracket(entries(1), RULE)).toThrow(BracketError)
    expect(() => buildBracket([{ id: "a", rating: 1 }, { id: "a", rating: 2 }], RULE)).toThrow(
      BracketError,
    )
  })
})

describe("byes", () => {
  it("gives byes to the top seeds when the count is not a power of two", () => {
    const b = buildBracket(entries(5), RULE)
    expect(b.size).toBe(8)
    expect(b.rounds).toBe(3)
    const byes = b.matches.filter((x) => x.resolution === "bye")
    expect(byes.map((x) => x.winner).sort()).toEqual(["e1", "e2", "e3"])
    // Only 4 v 5 is played in round one. 2 v 3 is already ready in round two.
    expect(playableMatches(b).map((x) => [x.a, x.b])).toEqual([
      ["e4", "e5"],
      ["e2", "e3"],
    ])
    // Seeds 2 and 3 meet in round two straight away.
    expect(m(b, "r2m1").status).toBe("ready")
    expect([m(b, "r2m1").a, m(b, "r2m1").b]).toEqual(["e2", "e3"])
  })

  it("never pairs two byes", () => {
    for (let n = 2; n <= 64; n++) {
      const b = buildBracket(entries(n), RULE)
      const r1 = b.matches.filter((x) => x.round === 1)
      expect(r1.every((x) => x.a !== null || x.b !== null)).toBe(true)
      expect(b.matches.some((x) => x.resolution === "void")).toBe(false)
      expect(isComplete(playOut(b))).toBe(true)
    }
  })

  it("handles a two entry bracket as a single Bo3 final", () => {
    const b = buildBracket(entries(2), RULE)
    expect(b.rounds).toBe(1)
    expect(m(b, "r1m0").bestOf).toBe(3)
  })
})

describe("advancement", () => {
  it("advances winners into the correct slot", () => {
    let b = buildBracket(entries(4), RULE)
    b = play(b, "r1m0", "b") // e4 beats e1
    expect(m(b, "r2m0").a).toBe("e4")
    expect(m(b, "r2m0").aSeed).toBe(4)
    expect(m(b, "r2m0").status).toBe("pending")
    b = play(b, "r1m1", "a") // e2 beats e3
    expect(m(b, "r2m0").b).toBe("e2")
    expect(m(b, "r2m0").status).toBe("ready")
  })

  it("sets Bo1 before the final and Bo3 in the final", () => {
    const b = buildBracket(entries(16), RULE)
    expect(b.matches.filter((x) => x.round < 4).every((x) => x.bestOf === 1)).toBe(true)
    expect(m(b, "r4m0").bestOf).toBe(3)
  })

  it("only accepts results for the live game and ignores repeats", () => {
    let b = buildBracket(entries(4), RULE)
    expect(() => recordGame(b, "r1m0", "gx", "a")).toThrow(BracketError)
    b = startGame(b, "r1m0", "g-live")
    expect(() => startGame(b, "r1m0", "g-other")).toThrow(BracketError)
    const after = recordGame(b, "r1m0", "g-live", "a")
    expect(recordGame(after, "r1m0", "g-live", "b")).toBe(after)
    expect(m(after, "r1m0").winner).toBe("e1")
  })

  it("does not mutate its input", () => {
    const b = buildBracket(entries(4), RULE)
    const snap = JSON.stringify(b)
    play(b, "r1m0", "a")
    forfeit(b, "r1m1", ["a"])
    expect(JSON.stringify(b)).toBe(snap)
  })

  it("puts a cancelled game back to ready", () => {
    let b = buildBracket(entries(2), RULE)
    b = startGame(b, "r1m0", "g1")
    b = cancelGame(b, "r1m0", "g1")
    expect(m(b, "r1m0").status).toBe("ready")
    expect(m(b, "r1m0").liveMatchId).toBeNull()
  })

  it("claims and releases a match while a server is requested", () => {
    let b = buildBracket(entries(2), RULE)
    b = claimGame(b, "r1m0")
    expect(m(b, "r1m0").status).toBe("provisioning")
    expect(playableMatches(b)).toHaveLength(0)
    expect(() => claimGame(b, "r1m0")).toThrow(BracketError)
    const released = releaseGame(b, "r1m0")
    expect(m(released, "r1m0").status).toBe("ready")
    expect(releaseGame(released, "r1m0")).toBe(released)
    const live = startGame(b, "r1m0", "g1")
    expect(m(live, "r1m0").status).toBe("live")
    expect(m(live, "r1m0").liveMatchId).toBe("g1")
  })

  it("reports placements", () => {
    const done = playOut(buildBracket(entries(8), RULE))
    const p = placements(done)
    expect(p.champion).toBe("e1")
    expect(p.runnerUp).toBe("e2")
    expect(p.semifinalists.sort()).toEqual(["e3", "e4"])
  })
})

describe("forfeits", () => {
  it("advances the present side when one side is absent", () => {
    let b = buildBracket(entries(4), RULE)
    b = startGame(b, "r1m0", "g1")
    b = forfeit(b, "r1m0", ["a"])
    expect(m(b, "r1m0").resolution).toBe("forfeit")
    expect(m(b, "r2m0").a).toBe("e4")
  })

  it("gives a walkover when both sides of a match forfeit", () => {
    let b = buildBracket(entries(4), RULE)
    b = forfeit(b, "r1m0", ["a", "b"])
    expect(m(b, "r1m0").winner).toBeNull()
    expect(m(b, "r1m0").resolution).toBe("double_forfeit")
    b = play(b, "r1m1", "a")
    expect(m(b, "r2m0").status).toBe("done")
    expect(m(b, "r2m0").resolution).toBe("walkover")
    expect(placements(b)).toEqual({ champion: "e2", runnerUp: null, semifinalists: ["e3"] })
  })

  it("voids a later match when both feeders were double forfeits", () => {
    let b = buildBracket(entries(8), RULE)
    b = forfeit(b, "r1m0", ["a", "b"])
    b = forfeit(b, "r1m1", ["a", "b"])
    expect(m(b, "r2m0").resolution).toBe("void")
    expect(m(b, "r3m0").aResolved).toBe(true)
    expect(m(b, "r3m0").a).toBeNull()
  })

  it("gives no placement to a side that forfeited", () => {
    let b = buildBracket(entries(4), RULE)
    b = forfeit(b, "r1m0", ["b"])
    b = play(b, "r1m1", "a")
    b = forfeit(b, "r2m0", ["b"])
    expect(placements(b)).toEqual({ champion: "e1", runnerUp: null, semifinalists: ["e3"] })
  })

  it("refuses to forfeit a finished match", () => {
    const b = play(buildBracket(entries(4), RULE), "r1m0", "a")
    expect(() => forfeit(b, "r1m0", ["b"])).toThrow(BracketError)
  })
})

describe("Bo3 series", () => {
  it("needs two wins", () => {
    expect(winsNeeded(1)).toBe(1)
    expect(winsNeeded(3)).toBe(2)
    expect(winsNeeded(5)).toBe(3)
  })

  it("goes back to ready between games and ends at two wins", () => {
    let b = buildBracket(entries(2), RULE)
    b = play(b, "r1m0", "a")
    expect(m(b, "r1m0").status).toBe("ready")
    expect(seriesScore(m(b, "r1m0"))).toEqual({ a: 1, b: 0 })
    b = play(b, "r1m0", "b")
    expect(m(b, "r1m0").status).toBe("ready")
    expect(seriesScore(m(b, "r1m0"))).toEqual({ a: 1, b: 1 })
    b = play(b, "r1m0", "b")
    expect(m(b, "r1m0").status).toBe("done")
    expect(m(b, "r1m0").winner).toBe("e2")
    expect(m(b, "r1m0").games).toHaveLength(3)
    expect(isComplete(b)).toBe(true)
  })

  it("ends a 2-0 series without a third game", () => {
    let b = buildBracket(entries(2), RULE)
    b = play(b, "r1m0", "a")
    b = play(b, "r1m0", "a")
    expect(m(b, "r1m0").winner).toBe("e1")
    expect(m(b, "r1m0").games).toHaveLength(2)
  })

  it("lets a mid series forfeit decide the series", () => {
    let b = buildBracket(entries(2), RULE)
    b = play(b, "r1m0", "a")
    b = forfeit(startGame(b, "r1m0", "g-2"), "r1m0", ["a"])
    expect(m(b, "r1m0").winner).toBe("e2")
    expect(m(b, "r1m0").resolution).toBe("forfeit")
  })
})
