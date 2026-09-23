import { z } from "zod"
import { SteamId64Schema } from "./common.js"

export const VetoActionSchema = z.enum(["ban", "pick"])
export type VetoAction = z.infer<typeof VetoActionSchema>

export const TeamIndexSchema = z.union([z.literal(0), z.literal(1)])
export type TeamIndex = z.infer<typeof TeamIndexSchema>

export const VetoStepSchema = z.object({
  action: VetoActionSchema,
  team: TeamIndexSchema,
})
export type VetoStep = z.infer<typeof VetoStepSchema>

export const VetoTeamSchema = z.object({
  id: z.string().min(1),
  steamIds: z.array(SteamId64Schema).min(1),
})
export type VetoTeam = z.infer<typeof VetoTeamSchema>

export const VetoHistoryEntrySchema = z.object({
  step: z.number().int().nonnegative(),
  action: VetoActionSchema,
  team: TeamIndexSchema,
  mapId: z.string(),
  votes: z.record(z.string(), z.string()),
  tieBroken: z.boolean(),
  noVotes: z.boolean(),
})
export type VetoHistoryEntry = z.infer<typeof VetoHistoryEntrySchema>

export const VetoStateSchema = z.object({
  pool: z.array(z.string()),
  teams: z.tuple([VetoTeamSchema, VetoTeamSchema]),
  steps: z.array(VetoStepSchema),
  stepIndex: z.number().int().nonnegative(),
  available: z.array(z.string()),
  // Votes for the current step only, keyed by steamId
  votes: z.record(z.string(), z.string()),
  history: z.array(VetoHistoryEntrySchema),
  done: z.boolean(),
  // Final play order once done. Picks in order, then the remaining maps as deciders
  maps: z.array(z.string()),
})
export type VetoState = z.infer<typeof VetoStateSchema>
