import { z } from "zod"

export const TrustLevelSchema = z.enum(["new", "verified", "trusted"])
export type TrustLevel = z.infer<typeof TrustLevelSchema>
export const TRUST_LEVELS = TrustLevelSchema.options

const TRUST_ORDER: Record<TrustLevel, number> = { new: 0, verified: 1, trusted: 2 }

export function trustAtLeast(level: TrustLevel, required: TrustLevel): boolean {
  return TRUST_ORDER[level] >= TRUST_ORDER[required]
}
