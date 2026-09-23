// Pure single elimination bracket logic. No IO. Every function returns a new bracket.

export type Side = "a" | "b"
export type BracketMatchStatus = "pending" | "ready" | "provisioning" | "live" | "done"
export type Resolution =
  | "played"
  | "bye"
  | "walkover"
  | "forfeit"
  | "double_forfeit"
  | "void"
  | "disqualified"
  | "admin_decision"

export interface GameRecord {
  matchId: string
  winner: Side
}

export interface BracketMatch {
  // Stable key such as "r1m0".
  id: string
  round: number
  index: number
  bestOf: number
  a: string | null
  b: string | null
  aSeed: number | null
  bSeed: number | null
  // A side is resolved once its entry is known, or known to be empty.
  aResolved: boolean
  bResolved: boolean
  status: BracketMatchStatus
  games: GameRecord[]
  liveMatchId: string | null
  winner: string | null
  resolution: Resolution | null
}

export interface Bracket {
  size: number
  rounds: number
  matches: BracketMatch[]
}

export interface SeedEntry {
  id: string
  rating: number
  // Earlier sign-up wins a rating tie.
  registeredAt?: number
}

export interface BestOfRule {
  default: number
  semis: number
  final: number
}

export class BracketError extends Error {}

export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

// Seed numbers in bracket order. For 8 this is 1 8 4 5 2 7 3 6.
export function seedPositions(size: number): number[] {
  if (size < 2 || nextPowerOfTwo(size) !== size) throw new BracketError(`bad bracket size ${size}`)
  let order = [1, 2]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

export function seedEntries(entries: SeedEntry[]): SeedEntry[] {
  return [...entries].sort(
    (x, y) =>
      y.rating - x.rating ||
      (x.registeredAt ?? 0) - (y.registeredAt ?? 0) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  )
}

export function bestOfForRound(round: number, rounds: number, rule: BestOfRule): number {
  if (round === rounds) return rule.final
  if (round === rounds - 1) return rule.semis
  return rule.default
}

export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1
}

export function seriesScore(m: BracketMatch): { a: number; b: number } {
  let a = 0
  let b = 0
  for (const g of m.games) g.winner === "a" ? a++ : b++
  return { a, b }
}

export function matchKey(round: number, index: number): string {
  return `r${round}m${index}`
}

export function buildBracket(entries: SeedEntry[], rule: BestOfRule): Bracket {
  if (entries.length < 2) throw new BracketError("need at least two entries")
  const ids = new Set(entries.map((e) => e.id))
  if (ids.size !== entries.length) throw new BracketError("duplicate entry id")

  const seeded = seedEntries(entries)
  const size = nextPowerOfTwo(entries.length)
  const rounds = Math.log2(size)
  const positions = seedPositions(size)
  const matches: BracketMatch[] = []

  for (let round = 1; round <= rounds; round++) {
    const count = size >> round
    for (let index = 0; index < count; index++) {
      const m: BracketMatch = {
        id: matchKey(round, index),
        round,
        index,
        bestOf: bestOfForRound(round, rounds, rule),
        a: null,
        b: null,
        aSeed: null,
        bSeed: null,
        aResolved: false,
        bResolved: false,
        status: "pending",
        games: [],
        liveMatchId: null,
        winner: null,
        resolution: null,
      }
      if (round === 1) {
        const sa = positions[index * 2] as number
        const sb = positions[index * 2 + 1] as number
        m.a = seeded[sa - 1]?.id ?? null
        m.b = seeded[sb - 1]?.id ?? null
        m.aSeed = m.a ? sa : null
        m.bSeed = m.b ? sb : null
        m.aResolved = true
        m.bResolved = true
      }
      matches.push(m)
    }
  }
  return settle({ size, rounds, matches })
}

function clone(b: Bracket): Bracket {
  return { ...b, matches: b.matches.map((m) => ({ ...m, games: [...m.games] })) }
}

function find(b: Bracket, id: string): BracketMatch {
  const m = b.matches.find((x) => x.id === id)
  if (!m) throw new BracketError(`unknown bracket match ${id}`)
  return m
}

function finish(b: Bracket, m: BracketMatch, winner: string | null, resolution: Resolution) {
  m.status = "done"
  m.winner = winner
  m.resolution = resolution
  m.liveMatchId = null
  if (m.round === b.rounds) return
  const next = find(b, matchKey(m.round + 1, Math.floor(m.index / 2)))
  const seed = winner === null ? null : winner === m.a ? m.aSeed : m.bSeed
  if (m.index % 2 === 0) {
    next.a = winner
    next.aSeed = seed
    next.aResolved = true
  } else {
    next.b = winner
    next.bSeed = seed
    next.bResolved = true
  }
}

// Moves every pending match whose sides are known to ready, or resolves it
// straight away when a side is empty.
function settle(input: Bracket): Bracket {
  const b = input
  let changed = true
  while (changed) {
    changed = false
    for (const m of b.matches) {
      if (m.status !== "pending" || !m.aResolved || !m.bResolved) continue
      changed = true
      if (m.a && m.b) m.status = "ready"
      else if (m.a || m.b) finish(b, m, m.a ?? m.b, m.round === 1 ? "bye" : "walkover")
      else finish(b, m, null, "void")
    }
  }
  return b
}

// Matches that need a server for their next game.
export function playableMatches(b: Bracket): BracketMatch[] {
  return b.matches.filter((m) => m.status === "ready")
}

// Marks a ready match while a server is requested for its next game.
export function claimGame(input: Bracket, bracketMatchId: string): Bracket {
  const b = clone(input)
  const m = find(b, bracketMatchId)
  if (m.status !== "ready") throw new BracketError(`${m.id} is ${m.status}, not ready`)
  m.status = "provisioning"
  return b
}

// Puts a claimed match back to ready so the next tick can try again.
export function releaseGame(input: Bracket, bracketMatchId: string): Bracket {
  const current = find(input, bracketMatchId)
  if (current.status !== "provisioning") return input
  const b = clone(input)
  find(b, bracketMatchId).status = "ready"
  return b
}

export function startGame(input: Bracket, bracketMatchId: string, gameMatchId: string): Bracket {
  const b = clone(input)
  const m = find(b, bracketMatchId)
  if (m.status !== "ready" && m.status !== "provisioning") {
    throw new BracketError(`${m.id} is ${m.status}, not ready`)
  }
  m.status = "live"
  m.liveMatchId = gameMatchId
  return b
}

// The live game did not run. The match goes back to ready so it can be provisioned again.
export function cancelGame(input: Bracket, bracketMatchId: string, gameMatchId: string): Bracket {
  const b = clone(input)
  const m = find(b, bracketMatchId)
  if (m.status !== "live" || m.liveMatchId !== gameMatchId) return input
  m.status = "ready"
  m.liveMatchId = null
  return b
}

export function recordGame(
  input: Bracket,
  bracketMatchId: string,
  gameMatchId: string,
  winner: Side,
): Bracket {
  const current = find(input, bracketMatchId)
  // Repeated results for the same game are ignored.
  if (current.games.some((g) => g.matchId === gameMatchId)) return input
  if (current.status !== "live" || current.liveMatchId !== gameMatchId) {
    throw new BracketError(`${current.id} is not live with game ${gameMatchId}`)
  }
  const b = clone(input)
  const m = find(b, bracketMatchId)
  m.games.push({ matchId: gameMatchId, winner })
  m.liveMatchId = null
  const score = seriesScore(m)
  const need = winsNeeded(m.bestOf)
  if (score.a >= need) finish(b, m, m.a, "played")
  else if (score.b >= need) finish(b, m, m.b, "played")
  else m.status = "ready"
  return settle(b)
}

// Forfeits the whole series. Both sides forfeiting eliminates both.
export function forfeit(input: Bracket, bracketMatchId: string, losers: Side[]): Bracket {
  const current = find(input, bracketMatchId)
  if (current.status !== "ready" && current.status !== "provisioning" && current.status !== "live") {
    throw new BracketError(`${current.id} is ${current.status}, cannot forfeit`)
  }
  if (losers.length === 0) return input
  const b = clone(input)
  const m = find(b, bracketMatchId)
  const aLoses = losers.includes("a")
  const bLoses = losers.includes("b")
  if (aLoses && bLoses) finish(b, m, null, "double_forfeit")
  else finish(b, m, aLoses ? m.b : m.a, "forfeit")
  return settle(b)
}

const OPEN_STATUSES: BracketMatchStatus[] = ["ready", "provisioning", "live"]

// Removes one side from a match that is waiting or being played. The other side advances.
export function disqualify(input: Bracket, bracketMatchId: string, loser: Side): Bracket {
  const current = find(input, bracketMatchId)
  if (!OPEN_STATUSES.includes(current.status)) {
    throw new BracketError(`${current.id} is ${current.status}, cannot disqualify`)
  }
  const b = clone(input)
  const m = find(b, bracketMatchId)
  finish(b, m, loser === "a" ? m.b : m.a, "disqualified")
  return settle(b)
}

// An admin names the series winner, for example after a dispute.
export function decide(input: Bracket, bracketMatchId: string, winner: Side): Bracket {
  const current = find(input, bracketMatchId)
  if (!OPEN_STATUSES.includes(current.status)) {
    throw new BracketError(`${current.id} is ${current.status}, cannot decide`)
  }
  const b = clone(input)
  const m = find(b, bracketMatchId)
  finish(b, m, winner === "a" ? m.a : m.b, "admin_decision")
  return settle(b)
}

export function finalMatch(b: Bracket): BracketMatch {
  return find(b, matchKey(b.rounds, 0))
}

export function isComplete(b: Bracket): boolean {
  return finalMatch(b).status === "done"
}

export interface Placements {
  champion: string | null
  runnerUp: string | null
  semifinalists: string[]
}

// A side that lost by forfeit or disqualification earns no placement.
function loserOf(m: BracketMatch): string | null {
  if (m.status !== "done" || m.winner === null) return null
  if (m.resolution === "forfeit" || m.resolution === "disqualified") return null
  const loser = m.winner === m.a ? m.b : m.a
  return loser ?? null
}

export function placements(b: Bracket): Placements {
  if (!isComplete(b)) throw new BracketError("bracket is not complete")
  const final = finalMatch(b)
  const semis = b.rounds >= 2 ? b.matches.filter((m) => m.round === b.rounds - 1) : []
  return {
    champion: final.winner,
    runnerUp: loserOf(final),
    semifinalists: semis.map(loserOf).filter((x): x is string => x !== null),
  }
}

// Which side an entry is on in a match, or null.
export function sideOf(m: BracketMatch, entryId: string): Side | null {
  if (m.a === entryId) return "a"
  if (m.b === entryId) return "b"
  return null
}
