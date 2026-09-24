import { z } from "zod"
import { SteamId64Schema } from "./common.js"

// side: the acting team chooses the side it plays on a map of a Rush series room veto
export const VetoActionSchema = z.enum(["ban", "pick", "side"])
export type VetoAction = z.infer<typeof VetoActionSchema>

export const TeamIndexSchema = z.union([z.literal(0), z.literal(1)])
export type TeamIndex = z.infer<typeof TeamIndexSchema>

export const VetoStepSchema = z.object({
  action: VetoActionSchema,
  team: TeamIndexSchema,
  // Index into VetoState.phases. The step only offers that phase's pool
  phase: z.number().int().nonnegative().optional(),
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
  // Separate pools for steps that carry a phase, such as Rush mid rooms then start rooms
  phases: z
    .array(
      z.object({
        id: z.string(),
        pool: z.array(z.string()),
        // Series room veto only. The map the phase decides, counting from 1, and what it decides
        mapNumber: z.number().int().positive().optional(),
        kind: z.enum(["side", "mid", "start"]).optional(),
      }),
    )
    .optional(),
  // Series room veto only. The team that won the coin flip before the veto started. It is team A on the last map
  flipWinner: TeamIndexSchema.optional(),
})
export type VetoState = z.infer<typeof VetoStateSchema>

// maps is the map veto. rooms is the Rush room ban and pick, where pool entries are room ids.
// series-rooms is the Rush room pick for a whole series, where pool entries are room ids and side keys
export const VetoKindSchema = z.enum(["maps", "rooms", "series-rooms"])
export type VetoKind = z.infer<typeof VetoKindSchema>
