import { z } from "zod"

export const TrustLevelSchema = z.enum(["new", "verified", "trusted"])
export type TrustLevel = z.infer<typeof TrustLevelSchema>
export const TRUST_LEVELS = TrustLevelSchema.options

const TRUST_ORDER: Record<TrustLevel, number> = { new: 0, verified: 1, trusted: 2 }

export function trustAtLeast(level: TrustLevel, required: TrustLevel): boolean {
  return TRUST_ORDER[level] >= TRUST_ORDER[required]
}

// Progress toward the next trust level, served on GET /me and the own profile

export const TrustRequirementKeySchema = z.enum(["steam_check", "faceit_check", "matches", "clean_history", "account_age"])
export type TrustRequirementKey = z.infer<typeof TrustRequirementKeySchema>

export const TrustRequirementSchema = z.object({
  key: TrustRequirementKeySchema,
  label: z.string(),
  met: z.boolean(),
  progress: z.object({ current: z.number().nonnegative(), required: z.number().nonnegative() }).optional(),
})
export type TrustRequirement = z.infer<typeof TrustRequirementSchema>

export const TrustProgressSchema = z.object({
  level: TrustLevelSchema,
  // null at the top level
  next: z.enum(["verified", "trusted"]).nullable(),
  requirements: z.array(TrustRequirementSchema),
  // Set when something outside the player's control stops automatic promotion, such as a ban
  blockedBy: z.string().optional(),
})
export type TrustProgress = z.infer<typeof TrustProgressSchema>

// What other players see on a profile
export const PublicTrustSchema = z.object({ level: TrustLevelSchema })
export type PublicTrust = z.infer<typeof PublicTrustSchema>

export const TrustLevelDefinitionSchema = z.object({
  level: TrustLevelSchema,
  label: z.string(),
  description: z.string(),
  // Requirements to reach this level. Empty for new
  requirements: z.array(
    z.object({
      key: TrustRequirementKeySchema,
      label: z.string(),
      required: z.number().nonnegative().optional(),
    }),
  ),
})
export type TrustLevelDefinition = z.infer<typeof TrustLevelDefinitionSchema>

// Body of GET /trust/levels
export const TrustLevelsResponseSchema = z.object({
  levels: z.array(TrustLevelDefinitionSchema),
  thresholds: z.object({
    verifiedMinMatches: z.number().int().nonnegative(),
    trustedMinMatches: z.number().int().nonnegative(),
    trustedMinAccountDays: z.number().int().nonnegative(),
    banGraceDays: z.number().int().nonnegative(),
  }),
})
export type TrustLevelsResponse = z.infer<typeof TrustLevelsResponseSchema>
