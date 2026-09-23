import { z } from "zod"
import { TierIdSchema } from "../config/tiers.js"
import { PlayerCardSchema, UuidSchema } from "./common.js"
import { MatchStatusSchema } from "./match.js"
import { ModeSchema } from "./mode.js"

// Queue ETA settings. Median wait of matches made in the window, null below the sample floor
export const QUEUE_ETA_WINDOW_SEC = 30 * 60
export const QUEUE_ETA_MIN_SAMPLES = 3

// GET /leaderboard/:mode/distribution
export const TierShareSchema = z.object({
  tier: TierIdSchema,
  count: z.number().int().nonnegative(),
  // Share of placed players, 0 to 1
  pct: z.number().min(0).max(1),
})
export type TierShare = z.infer<typeof TierShareSchema>

export const TierDistributionSchema = z.object({
  mode: ModeSchema,
  // Placed players counted
  total: z.number().int().nonnegative(),
  // Every tier low to high, zero counts included
  tiers: z.array(TierShareSchema),
  // Only for a signed in player with a rating in the mode
  you: z
    .object({
      tier: TierIdSchema,
      rating: z.number(),
      // Percent of placed players rated below you, 0 to 100
      percentile: z.number().min(0).max(100),
      placed: z.boolean(),
    })
    .optional(),
})
export type TierDistribution = z.infer<typeof TierDistributionSchema>

// GET /status
export const ModeUnavailableReasonSchema = z.enum(["not_configured", "no_servers", "servers_updating", "closed"])
export type ModeUnavailableReason = z.infer<typeof ModeUnavailableReasonSchema>

export const RegionStatusSchema = z.object({
  region: z.string(),
  hosts: z.number().int().nonnegative(),
  // Hosts that are online or updating
  hostsOnline: z.number().int().nonnegative(),
  slotsTotal: z.number().int().nonnegative(),
  slotsFree: z.number().int().nonnegative(),
  updating: z.boolean(),
})
export type RegionStatus = z.infer<typeof RegionStatusSchema>

export const ServiceStatusSchema = z.object({
  regions: z.array(RegionStatusSchema),
  surge: z.object({ enabled: z.boolean(), active: z.number().int().nonnegative() }),
  modes: z.array(
    z.object({
      mode: ModeSchema,
      available: z.boolean(),
      reason: ModeUnavailableReasonSchema.optional(),
    }),
  ),
  // ISO 8601
  updatedAt: z.string(),
})
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>

// GET /matches/live
export const LiveMatchPlayerSchema = PlayerCardSchema
export type LiveMatchPlayer = z.infer<typeof LiveMatchPlayerSchema>

export const LiveMatchSchema = z.object({
  id: UuidSchema,
  mode: ModeSchema,
  mapId: z.string().nullable(),
  status: MatchStatusSchema,
  // ISO 8601. null until the match starts
  startedAt: z.string().nullable(),
  teams: z.array(
    z.object({
      name: z.string(),
      score: z.number().int().nonnegative(),
      players: z.array(LiveMatchPlayerSchema),
    }),
  ),
  tournament: z.object({ id: UuidSchema, name: z.string() }).optional(),
  // Highest player rating in the match for its mode. Used for ordering
  topRating: z.number().nullable().optional(),
})
export type LiveMatch = z.infer<typeof LiveMatchSchema>

export const LiveMatchesSchema = z.object({ matches: z.array(LiveMatchSchema) })
export type LiveMatches = z.infer<typeof LiveMatchesSchema>
