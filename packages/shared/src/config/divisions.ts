import { TIERS, tierForRating, type TierBand } from "./tiers.js"

// Every tier below the top one splits into equal divisions, I lowest and III highest.
// The top tier (no upper bound) has no divisions: it shows the leaderboard place instead.
// Bands come from TIERS, so retuning the tiers retunes the divisions with them.
export const TIER_DIVISIONS = 3

export type Division = 1 | 2 | 3

export const DIVISION_NUMERALS = ["I", "II", "III"] as const

export type DivisionBand = {
  division: Division
  numeral: (typeof DIVISION_NUMERALS)[number]
  // Inclusive lower bound. null means no lower bound
  min: number | null
  // Exclusive upper bound
  max: number
}

// True for the top tier, which ranks by leaderboard place rather than division
export function isTopTier(tier: TierBand): boolean {
  return tier.max === null
}

// Width of a tier for splitting. A tier with no floor borrows the width of the tier above it
function tierWidth(tier: TierBand): number {
  if (tier.min !== null && tier.max !== null) return tier.max - tier.min
  const i = TIERS.findIndex((t) => t.id === tier.id)
  const next = TIERS[i + 1]
  if (tier.min === null && next && next.min !== null && next.max !== null) return next.max - next.min
  throw new Error(`tier ${tier.id} has no width to split`)
}

// The division bands of a tier, low to high. Empty for the top tier. Division edges are
// whole rating points; the last division absorbs any remainder
export function divisionBands(tier: TierBand): DivisionBand[] {
  if (isTopTier(tier)) return []
  const max = tier.max as number
  const width = tierWidth(tier)
  const step = Math.floor(width / TIER_DIVISIONS)
  const floor = max - width
  return DIVISION_NUMERALS.map((numeral, k) => {
    const division = (k + 1) as Division
    const lo = floor + k * step
    const hi = k === TIER_DIVISIONS - 1 ? max : lo + step
    // The first division of a floorless tier stays open ended downwards
    return { division, numeral, min: k === 0 && tier.min === null ? null : lo, max: hi }
  })
}

// Division for a rating, or null in the top tier. Ratings are rounded first, like tierForRating
export function divisionForRating(rating: number): Division | null {
  const r = Math.round(rating)
  const bands = divisionBands(tierForRating(r))
  if (bands.length === 0) return null
  const band = bands.find((b) => (b.min === null || r >= b.min) && r < b.max)
  return (band ?? bands[0]!).division
}

export function divisionNumeral(division: Division): string {
  return DIVISION_NUMERALS[division - 1]!
}

// "Gold II", or the bare tier name in the top tier
export function rankLabel(rating: number): string {
  const tier = tierForRating(rating)
  const d = divisionForRating(rating)
  return d === null ? tier.displayName : `${tier.displayName} ${divisionNumeral(d)}`
}
