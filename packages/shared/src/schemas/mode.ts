import { z } from "zod"

// rush1v1 is a test queue. It is unrated and off unless the API enables it
export const ModeSchema = z.enum(["aim1v1", "aim2v2", "rush3v3", "rush1v1"])
export type Mode = z.infer<typeof ModeSchema>
export const MODES = ModeSchema.options

const WeaponSchema = z.string().regex(/^weapon_[a-z0-9_]{1,40}$/)
const WeaponPairSchema = z.object({ ct: WeaponSchema.optional(), t: WeaponSchema.optional() })

// Aim map loadout. The plugin has a default per map, this overrides it
export const MapLoadoutSchema = z.object({
  primary: WeaponPairSchema.optional(),
  secondary: WeaponPairSchema.optional(),
  armor: z.enum(["none", "kevlar", "kevlar_helmet"]).optional(),
})
export type MapLoadout = z.infer<typeof MapLoadoutSchema>

export const MapEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  workshopId: z.string().optional(),
  mapName: z.string().optional(),
  loadout: MapLoadoutSchema.optional(),
})
export type MapEntry = z.infer<typeof MapEntrySchema>

export const VetoFormatSchema = z.enum(["none", "bo1-ban", "ban-to-7", "bo3-pickban"])
export type VetoFormat = z.infer<typeof VetoFormatSchema>

export const WinConditionSchema = z.enum(["first_to_13", "valve_rush"])
export type WinCondition = z.infer<typeof WinConditionSchema>

// Plain cfg file name, no directories
export const CFG_NAME_RE = /^[A-Za-z0-9_-]{1,64}\.cfg$/
export const WORKSHOP_ID_RE = /^[0-9]{1,20}$/
export const MAP_NAME_RE = /^[A-Za-z0-9_]{1,64}$/
// Command line extra args must be a flag or a plain value
export const LAUNCH_ARG_RE = /^(?:[+-][A-Za-z0-9_]{1,64}|[A-Za-z0-9_.-]{1,64})$/

// How a mode launches. This is the single source of truth for the agent and DatHost
export const Cs2LaunchSchema = z.object({
  gameType: z.number().int().min(0).max(100),
  gameMode: z.number().int().min(0).max(100),
  // Our cfg, shipped by the agent. Valve's gamemode cfg runs by itself on map load
  execCfg: z.string().regex(CFG_NAME_RE),
  // Extra server command line args, placed after game_mode and before the map
  extraArgs: z.array(z.string().regex(LAUNCH_ARG_RE)).max(16).optional(),
})
export type Cs2Launch = z.infer<typeof Cs2LaunchSchema>

// The launch block sent to a driver. The mode launch plus exactly one map target
export const Cs2StartSchema = Cs2LaunchSchema.extend({
  workshopId: z.string().regex(WORKSHOP_ID_RE).optional(),
  mapName: z.string().regex(MAP_NAME_RE).optional(),
}).refine((v) => (v.workshopId === undefined) !== (v.mapName === undefined), {
  message: "cs2 needs exactly one of workshopId or mapName",
})
export type Cs2Start = z.infer<typeof Cs2StartSchema>

export const ModeConfigSchema = z.object({
  mode: ModeSchema,
  teamSize: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maps: z.array(MapEntrySchema).min(1),
  vetoFormat: VetoFormatSchema,
  winCondition: WinConditionSchema,
  cs2: Cs2LaunchSchema,
  // A test mode is unrated, has no leaderboard or cups and is hidden unless enabled
  test: z.boolean().optional(),
})
export type ModeConfig = z.infer<typeof ModeConfigSchema>
