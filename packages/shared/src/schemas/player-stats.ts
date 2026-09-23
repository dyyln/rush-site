import { z } from "zod"

// Per mode streaks on GET /users/:steamId/profile, over finished and abandoned matches
export const StreakSchema = z.object({
  // Positive for a run of wins, negative for a run of losses, 0 with no matches
  current: z.number().int(),
  // Longest run of wins ever
  longest: z.number().int().nonnegative(),
})
export type Streak = z.infer<typeof StreakSchema>

// Weapon with the most kills by the player across all matches
export const FavouriteWeaponSchema = z.object({
  weapon: z.string(),
  kills: z.number().int().positive(),
})
export type FavouriteWeapon = z.infer<typeof FavouriteWeaponSchema>

export const ProfileExtrasSchema = z.object({
  favouriteWeapon: FavouriteWeaponSchema.nullable(),
})
export type ProfileExtras = z.infer<typeof ProfileExtrasSchema>

type Result = "win" | "loss" | "abandoned"

// Results in time order, oldest first. Abandons count as losses
export function computeStreak(results: readonly Result[]): Streak {
  let longest = 0
  let run = 0
  for (const r of results) {
    run = r === "win" ? (run > 0 ? run + 1 : 1) : run < 0 ? run - 1 : -1
    if (run > longest) longest = run
  }
  return { current: run, longest }
}
