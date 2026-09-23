import { z } from "zod"

export const TierIdSchema = z.enum(["iron", "bronze", "silver", "gold", "platinum", "elite"])
export type TierId = z.infer<typeof TierIdSchema>

export type TierBand = {
  id: TierId
  displayName: string
  // Inclusive lower bound. null means no lower bound
  min: number | null
  // Exclusive upper bound. null means no upper bound
  max: number | null
}

// Ordered low to high. Tune once the rating distribution is visible.
export const TIERS: readonly TierBand[] = [
  { id: "iron", displayName: "Iron", min: null, max: 1000 },
  { id: "bronze", displayName: "Bronze", min: 1000, max: 1300 },
  { id: "silver", displayName: "Silver", min: 1300, max: 1600 },
  { id: "gold", displayName: "Gold", min: 1600, max: 1900 },
  { id: "platinum", displayName: "Platinum", min: 1900, max: 2200 },
  { id: "elite", displayName: "Elite", min: 2200, max: null },
]

// Ratings are rounded before banding so 1299.6 shows as 1300 and Silver
export function tierForRating(rating: number): TierBand {
  const r = Math.round(rating)
  const band = TIERS.find((t) => (t.min === null || r >= t.min) && (t.max === null || r < t.max))
  if (!band) throw new Error(`no tier for rating ${rating}`)
  return band
}

export const LEADERBOARD_MIN_MATCHES = 20
