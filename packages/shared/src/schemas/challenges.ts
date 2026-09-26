import { z } from "zod"
import { PlayerCardSchema, SteamId64Schema, UuidSchema } from "./common.js"
import { ModeSchema } from "./mode.js"

// Open challenges expire after this long
export const CHALLENGE_TTL_SEC = 600

export const ChallengeStatusSchema = z.enum(["open", "accepted", "declined", "expired", "cancelled"])
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>

export const ChallengePlayerSchema = PlayerCardSchema
export type ChallengePlayer = z.infer<typeof ChallengePlayerSchema>

export const ChallengeMapSchema = z.object({ id: z.string(), displayName: z.string() })
export type ChallengeMap = z.infer<typeof ChallengeMapSchema>

export const ChallengeSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1),
  mode: ModeSchema,
  status: ChallengeStatusSchema,
  createdBy: ChallengePlayerSchema,
  // null for an open link anyone may accept. Set to the accepter once accepted
  target: ChallengePlayerSchema.nullable(),
  rematchOfMatchId: UuidSchema.nullable(),
  // A map chosen by the creator skips the veto. null keeps the veto
  map: ChallengeMapSchema.nullable(),
  // Set once accepted
  matchId: UuidSchema.nullable(),
  // ISO timestamps
  createdAt: z.string(),
  expiresAt: z.string(),
})
export type Challenge = z.infer<typeof ChallengeSchema>

export const CreateChallengeBodySchema = z.object({
  mode: ModeSchema,
  targetSteamId: SteamId64Schema.optional(),
  rematchOfMatchId: UuidSchema.optional(),
  // Aim modes only. Must be in the mode's map pool
  mapId: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
})
export type CreateChallengeBody = z.infer<typeof CreateChallengeBodySchema>

export const CreateChallengeResponseSchema = z.object({
  challenge: ChallengeSchema,
  // Full web URL of the challenge page
  url: z.string(),
})
export type CreateChallengeResponse = z.infer<typeof CreateChallengeResponseSchema>

// Public read for link previews. No steam ids or match ids
export const ChallengePreviewSchema = z.object({
  code: z.string(),
  mode: ModeSchema,
  status: ChallengeStatusSchema,
  createdBy: z.object({ displayName: z.string(), avatarUrl: z.string().nullable() }),
  // true when anyone with the link may accept
  open: z.boolean(),
  rematch: z.boolean(),
  map: ChallengeMapSchema.nullable(),
  expiresAt: z.string(),
})
export type ChallengePreview = z.infer<typeof ChallengePreviewSchema>

export const ChallengeUpdatePayloadSchema = z.object({
  challenge: ChallengeSchema,
})
export type ChallengeUpdatePayload = z.infer<typeof ChallengeUpdatePayloadSchema>
