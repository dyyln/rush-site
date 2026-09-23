import { canMixBuckets, maxRatingDiffAfter, partyBucket, type Mode } from "@rushsite/shared"

export type MmTicket = {
  id: string
  size: number
  // Party mean rating
  rating: number
  enqueuedAt: number
  region: string
}

export type Proposal = {
  teams: [MmTicket[], MmTicket[]]
  means: [number, number]
  mixed: boolean
}

export type MatchmakerOptions = {
  mode: Mode
  teamSize: number
  now: number
  // How many nearby tickets are considered around each anchor
  maxCandidates?: number
  windowFor?: (waitSec: number) => number | null
  canMix?: (waitSec: number) => boolean
}

const waitSec = (t: MmTicket, now: number) => Math.max(0, (now - t.enqueuedAt) / 1000)

// Team rating is the mean over players, so a party ticket counts once per member
export function teamMean(team: MmTicket[]): number {
  const players = team.reduce((s, t) => s + t.size, 0)
  return team.reduce((s, t) => s + t.rating * t.size, 0) / players
}

// A team is a party team when any ticket in it is a real party
export function teamKind(team: MmTicket[]): "solo" | "party" {
  return team.some((t) => partyBucket(t.size) === "party") ? "party" : "solo"
}

// All subsets of pool whose sizes add up to target. Pool is small so brute force is fine
function subsetsSumming(pool: MmTicket[], target: number, start = 0): MmTicket[][] {
  if (target === 0) return [[]]
  const out: MmTicket[][] = []
  for (let i = start; i < pool.length; i++) {
    const t = pool[i]!
    if (t.size > target) continue
    for (const rest of subsetsSumming(pool, target - t.size, i + 1)) out.push([t, ...rest])
  }
  return out
}

// Greedy pass from the longest waiting ticket. Each anchor gets the best balanced match in its window.
// Party teams face party teams and solo teams face solo teams until every ticket involved may mix.
export function findMatches(tickets: MmTicket[], opts: MatchmakerOptions): Proposal[] {
  const windowFor = opts.windowFor ?? maxRatingDiffAfter
  const canMix = opts.canMix ?? ((w: number) => canMixBuckets(opts.mode, w))
  const maxCandidates = opts.maxCandidates ?? 9
  const sorted = [...tickets]
    .filter((t) => t.size >= 1 && t.size <= opts.teamSize)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id))
  const used = new Set<string>()
  const proposals: Proposal[] = []

  for (const anchor of sorted) {
    if (used.has(anchor.id)) continue
    const window = windowFor(waitSec(anchor, opts.now)) ?? Number.POSITIVE_INFINITY
    const candidates = sorted
      .filter(
        (t) =>
          t.id !== anchor.id &&
          !used.has(t.id) &&
          t.region === anchor.region &&
          Math.abs(t.rating - anchor.rating) <= window,
      )
      .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating) || a.enqueuedAt - b.enqueuedAt)
      .slice(0, maxCandidates)

    let best: { p: Proposal; key: [number, number, number] } | null = null
    for (const mates of subsetsSumming(candidates, opts.teamSize - anchor.size)) {
      const teamA = [anchor, ...mates]
      const taken = new Set(mates.map((m) => m.id))
      const rest = candidates.filter((c) => !taken.has(c.id))
      for (const teamB of subsetsSumming(rest, opts.teamSize)) {
        const meanA = teamMean(teamA)
        const meanB = teamMean(teamB)
        const diff = Math.abs(meanA - meanB)
        if (diff > window) continue
        const mixed = teamKind(teamA) !== teamKind(teamB)
        const all = [...teamA, ...teamB]
        if (mixed && !all.every((t) => canMix(waitSec(t, opts.now)))) continue
        // Prefer unmixed, then the closest means, then the longest waiting players
        const waited = all.reduce((s, t) => s + waitSec(t, opts.now), 0)
        const key: [number, number, number] = [mixed ? 1 : 0, diff, -waited]
        if (!best || compareKey(key, best.key) < 0) {
          best = { p: { teams: [teamA, teamB], means: [meanA, meanB], mixed }, key }
        }
      }
    }
    if (best) {
      for (const t of [...best.p.teams[0], ...best.p.teams[1]]) used.add(t.id)
      proposals.push(best.p)
    }
  }
  return proposals
}

function compareKey(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!
  }
  return 0
}
