import { z } from "zod"

export const ModeSchema = z.enum(["aim1v1", "aim2v2", "rush3v3"])
export type Mode = z.infer<typeof ModeSchema>
export const MODES = ModeSchema.options

export const MapEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  workshopId: z.string().optional(),
  mapName: z.string().optional(),
})
export type MapEntry = z.infer<typeof MapEntrySchema>

export const VetoFormatSchema = z.enum(["none", "bo1-ban", "ban-to-7", "bo3-pickban"])
export type VetoFormat = z.infer<typeof VetoFormatSchema>

export const WinConditionSchema = z.enum(["first_to_16", "valve_rush"])
export type WinCondition = z.infer<typeof WinConditionSchema>

export const Cs2LaunchSchema = z.object({
  gameType: z.number().int(),
  gameMode: z.number().int(),
  workshopCollection: z.string().optional(),
  execCfg: z.string().min(1),
  // Extra server command line args appended by the agent
  extraArgs: z.array(z.string()).optional(),
})
export type Cs2Launch = z.infer<typeof Cs2LaunchSchema>

export const ModeConfigSchema = z.object({
  mode: ModeSchema,
  teamSize: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maps: z.array(MapEntrySchema).min(1),
  vetoFormat: VetoFormatSchema,
  winCondition: WinConditionSchema,
  cs2: Cs2LaunchSchema,
})
export type ModeConfig = z.infer<typeof ModeConfigSchema>
