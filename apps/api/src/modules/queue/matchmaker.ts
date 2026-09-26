import { canMixBuckets, maxRatingDiffAfter, partyBucket, SOLE_MATCH_AFTER_SEC, type Mode } from "@rushsite/shared"

export type MmTicket = {
  id: string
  size: number
  // Party mean rating
  rating: number
  enqueuedAt: number
  region: string
  // Trust as a rank, new 0, verified 1, trusted 2. Every other player in the match must be at least minTrust. Missing means 0
  minTrust?: number
  // Lowest trust rank among the ticket's players
  trust?: number
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
  // Wait after which a queue too small for two matches ignores the rating window and party buckets
  soleMatchAfterSec?: number
}

// Individual players may sit further from the anchor than the team gap allows
const CANDIDATE_SPREAD = 2

const waitSec = (t: MmTicket, now: number) => Math.max(0, (now - t.enqueuedAt) / 1000)

// Both tickets meet each other's trust floor, whichever side they end up on. Waiting never relaxes this
export function trustCompatible(a: MmTicket, b: MmTicket): boolean {
  return (b.trust ?? 0) >= (a.minTrust ?? 0) && (a.trust ?? 0) >= (b.minTrust ?? 0)
}

// Team rating is the mean over players, so a party ticket counts once per member
export function teamMean(team: MmTicket[]): number {
  const players = team.reduce((s, t) => s + t.size, 0)
  return team.reduce((s, t) => s + t.rating * t.size, 0) / players
}

// A team is a party team when any ticket in it is a real party
export function teamKind(team: MmTicket[]): "solo" | "party" {
  return team.some((t) => partyBucket(t.size) === "party") ? "party" : "solo"
}

// Bitmasks of every subset of the pool whose sizes add up to target, in lexicographic index order.
// The pool is at most a few dozen tickets so brute force is fine
function subsetMasks(sizes: number[], target: number): number[] {
  const out: number[] = []
  const rec = (start: number, left: number, mask: number) => {
    if (left === 0) {
      out.push(mask)
      return
    }
    for (let i = start; i < sizes.length; i++) {
      if (sizes[i]! <= left) rec(i + 1, left - sizes[i]!, mask | (1 << i))
    }
  }
  rec(0, target, 0)
  return out
}

function pick(pool: MmTicket[], mask: number): MmTicket[] {
  const out: MmTicket[] = []
  for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) out.push(pool[i]!)
  return out
}

// Removal-aware neighbour lists over one region's tickets sorted by rating.
// Path compressed skip pointers make stepping past used tickets close to O(1).
class RatingIndex {
  readonly byRating: MmTicket[]
  private readonly pos = new Map<string, number>()
  private readonly nextRight: Int32Array
  private readonly nextLeft: Int32Array

  constructor(tickets: MmTicket[]) {
    this.byRating = [...tickets].sort((a, b) => a.rating - b.rating || a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id))
    this.byRating.forEach((t, i) => this.pos.set(t.id, i))
    const n = this.byRating.length
    this.nextRight = Int32Array.from({ length: n + 1 }, (_, i) => i)
    this.nextLeft = Int32Array.from({ length: n + 1 }, (_, i) => i)
  }

  remove(id: string): void {
    const i = this.pos.get(id)
    if (i === undefined) return
    this.nextRight[i] = i + 1
    // nextLeft is shifted by one so index 0 can stand for "none"
    this.nextLeft[i + 1] = i
  }

  // First unused index at or right of i, or n when none
  private right(i: number): number {
    let r = i
    while (this.nextRight[r] !== r) r = this.nextRight[r]!
    for (let k = i; this.nextRight[k] !== r; ) {
      const next = this.nextRight[k]!
      this.nextRight[k] = r
      k = next
    }
    return r
  }

  // First unused index at or left of i, or -1 when none
  private left(i: number): number {
    let r = i + 1
    while (this.nextLeft[r] !== r) r = this.nextLeft[r]!
    for (let k = i + 1; this.nextLeft[k] !== r; ) {
      const next = this.nextLeft[k]!
      this.nextLeft[k] = r
      k = next
    }
    return r - 1
  }

  // The k unused tickets nearest in rating to the anchor within maxGap, with ties at the cut kept
  nearest(anchor: MmTicket, k: number, maxGap: number, accept: (t: MmTicket) => boolean = () => true): MmTicket[] {
    const at = this.pos.get(anchor.id)!
    const n = this.byRating.length
    let l = this.left(at - 1)
    let r = this.right(at + 1)
    const out: MmTicket[] = []
    let cut = Number.POSITIVE_INFINITY
    for (;;) {
      const lt = l >= 0 ? this.byRating[l]! : null
      const rt = r < n ? this.byRating[r]! : null
      const ld = lt ? anchor.rating - lt.rating : Number.POSITIVE_INFINITY
      const rd = rt ? rt.rating - anchor.rating : Number.POSITIVE_INFINITY
      const d = Math.min(ld, rd)
      if (d > maxGap || d > cut || d === Number.POSITIVE_INFINITY) break
      if (ld <= rd) {
        if (accept(lt!)) out.push(lt!)
        l = this.left(l - 1)
      } else {
        if (accept(rt!)) out.push(rt!)
        r = this.right(r + 1)
      }
      if (out.length === k) cut = d
    }
    return out
  }
}

// Greedy pass from the longest waiting ticket. Each anchor gets the best balanced match in its window.
// The window bounds the gap between team means.
// Party teams face party teams and solo teams face solo teams until every ticket involved may mix.
// Candidates come from a rating sorted index per region, so a pass costs about O(N log N + N * k).
export function findMatches(tickets: MmTicket[], opts: MatchmakerOptions): Proposal[] {
  const windowFor = opts.windowFor ?? maxRatingDiffAfter
  const canMix = opts.canMix ?? ((w: number) => canMixBuckets(opts.mode, w))
  const maxCandidates = opts.maxCandidates ?? 9
  const sorted = [...tickets]
    .filter((t) => t.size >= 1 && t.size <= opts.teamSize)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id))
  const byRegion = new Map<string, MmTicket[]>()
  for (const t of sorted) {
    const list = byRegion.get(t.region)
    if (list) list.push(t)
    else byRegion.set(t.region, [t])
  }
  const indexes = new Map([...byRegion].map(([region, ts]) => [region, new RatingIndex(ts)]))
  // Regions without enough players for a second match. Waiting there for a closer opponent gains nothing
  const soleAfter = opts.soleMatchAfterSec ?? SOLE_MATCH_AFTER_SEC
  const small = new Set(
    [...byRegion].filter(([, ts]) => ts.reduce((s, t) => s + t.size, 0) < 4 * opts.teamSize).map(([region]) => region),
  )
  const used = new Set<string>()
  const proposals: Proposal[] = []

  for (const anchor of sorted) {
    if (used.has(anchor.id)) continue
    const index = indexes.get(anchor.region)!
    const sole = small.has(anchor.region) && waitSec(anchor, opts.now) >= soleAfter
    const mayMix = (t: MmTicket) => sole || canMix(waitSec(t, opts.now))
    const window = sole ? Number.POSITIVE_INFINITY : (windowFor(waitSec(anchor, opts.now)) ?? Number.POSITIVE_INFINITY)
    // Tickets that cannot share a match with the anchor are skipped so they do not crowd out usable ones
    const candidates = index
      .nearest(anchor, maxCandidates, window * CANDIDATE_SPREAD, (t) => trustCompatible(anchor, t))
      .sort(
        (a, b) =>
          Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating) ||
          a.enqueuedAt - b.enqueuedAt ||
          a.id.localeCompare(b.id),
      )
      .slice(0, maxCandidates)

    const best = bestProposal(anchor, candidates, window, opts.teamSize, mayMix, opts.now)
    if (best) {
      for (const t of [...best.p.teams[0], ...best.p.teams[1]]) {
        used.add(t.id)
        index.remove(t.id)
      }
      proposals.push(best.p)
    }
  }
  return proposals
}

// Best pairing of the anchor's team against another team from the candidates.
// Prefer unmixed, then the closest means, then the longest waiting players.
// Works on bitmasks so the inner loop allocates nothing
function bestProposal(
  anchor: MmTicket,
  candidates: MmTicket[],
  window: number,
  teamSize: number,
  mayMix: (t: MmTicket) => boolean,
  now: number,
): { p: Proposal } | null {
  const k = candidates.length
  const sizes: number[] = new Array(k)
  const weighted = new Float64Array(k)
  const party = new Uint8Array(k)
  const mix = new Uint8Array(k)
  // Bit j set when candidates i and j cannot share a match. Candidates already all accept the anchor
  const clash = new Int32Array(k)
  for (let i = 0; i < k; i++) {
    const c = candidates[i]!
    sizes[i] = c.size
    weighted[i] = c.rating * c.size
    party[i] = partyBucket(c.size) === "party" ? 1 : 0
    mix[i] = mayMix(c) ? 1 : 0
    for (let j = 0; j < k; j++) if (!trustCompatible(c, candidates[j]!)) clash[i] = clash[i]! | (1 << j)
  }
  // Same summation order as teamMean so ties resolve exactly as before
  const stats = (mask: number, sum0: number, players0: number, party0: number, mix0: number) => {
    let sum = sum0
    let players = players0
    let p = party0
    let m = mix0
    let c = 0
    for (let i = 0; i < k; i++) {
      if (!(mask & (1 << i))) continue
      sum += weighted[i]!
      players += sizes[i]!
      p |= party[i]!
      m &= mix[i]!
      c |= clash[i]!
    }
    return { mean: sum / players, party: p, mix: m, clash: c }
  }
  const bMasks = subsetMasks(sizes, teamSize)
  if (bMasks.length === 0) return null
  const bMean = new Float64Array(bMasks.length)
  const bParty = new Uint8Array(bMasks.length)
  const bMix = new Uint8Array(bMasks.length)
  const bClash = new Int32Array(bMasks.length)
  for (let j = 0; j < bMasks.length; j++) {
    const st = stats(bMasks[j]!, 0, 0, 0, 1)
    bMean[j] = st.mean
    bParty[j] = st.party
    bMix[j] = st.mix
    bClash[j] = st.clash
  }
  const waited = (a: MmTicket[], b: MmTicket[]) => [...a, ...b].reduce((s, t) => s + waitSec(t, now), 0)
  const anchorParty = partyBucket(anchor.size) === "party" ? 1 : 0
  const anchorMix = mayMix(anchor) ? 1 : 0

  let best: { a: MmTicket[]; bm: number; meanA: number; meanB: number; mixed: number; diff: number; waited: number | null } | null = null
  for (const am of subsetMasks(sizes, teamSize - anchor.size)) {
    const st = stats(am, anchor.rating * anchor.size, anchor.size, anchorParty, anchorMix)
    const meanA = st.mean
    const partyA = st.party
    const mixA = st.mix
    // Teammates are held to the floor too
    if (st.clash & am) continue
    let teamA: MmTicket[] | null = null
    for (let j = 0; j < bMasks.length; j++) {
      const bm = bMasks[j]!
      if (bm & am) continue
      // Every ticket's floor covers every player in the match. Checked before the rating window and never widened
      if ((st.clash | bClash[j]!) & (am | bm)) continue
      const diff = Math.abs(meanA - bMean[j]!)
      if (diff > window) continue
      const mixed = partyA !== bParty[j] ? 1 : 0
      if (mixed && !(mixA && bMix[j])) continue
      let better = !best || mixed < best.mixed || (mixed === best.mixed && diff < best.diff)
      let w: number | null = null
      if (!better && best && mixed === best.mixed && diff === best.diff) {
        teamA ??= [anchor, ...pick(candidates, am)]
        w = waited(teamA, pick(candidates, bm))
        best.waited ??= waited(best.a, pick(candidates, best.bm))
        better = w > best.waited
      }
      if (better) {
        teamA ??= [anchor, ...pick(candidates, am)]
        best = { a: teamA, bm, meanA, meanB: bMean[j]!, mixed, diff, waited: w }
      }
    }
  }
  if (!best) return null
  return { p: { teams: [best.a, pick(candidates, best.bm)], means: [best.meanA, best.meanB], mixed: best.mixed === 1 } }
}
