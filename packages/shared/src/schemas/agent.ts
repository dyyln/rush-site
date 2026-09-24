import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { Cs2StartSchema, MapEntrySchema, ModeSchema, WinConditionSchema } from "./mode.js"

export const TeamRosterSchema = z.object({
  // Team id used in results, such as A or B
  name: z.string().min(1),
  steamIds: z.array(SteamId64Schema),
  // Shown in game and on the match page when set, such as a cup team name
  displayName: z.string().min(1).max(32).optional(),
})
export type TeamRoster = z.infer<typeof TeamRosterSchema>

export const DemoUploadSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  presignedPutUrl: z.url(),
})
export type DemoUpload = z.infer<typeof DemoUploadSchema>

// A best-of series played on one server. Absent for single map matches
export const SeriesConfigSchema = z
  .object({
    bestOf: z.number().int().min(2).max(7),
    // Full ordered map list, one entry per map number
    maps: z.array(MapEntrySchema).min(2),
    // Map number to load first, counting from 1. Above 1 when a series resumes after a crash
    startMapNumber: z.number().int().positive(),
    // Maps each team already won before startMapNumber, keyed by team name
    wins: z.record(z.string(), z.number().int().nonnegative()),
    // One upload per map, index is mapNumber - 1
    demoUploads: z.array(DemoUploadSchema).min(2),
  })
  .refine((s) => s.maps.length === s.bestOf && s.demoUploads.length === s.bestOf, "maps and demoUploads need bestOf entries")
  .refine((s) => s.startMapNumber <= s.bestOf, "startMapNumber is past the last map")
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>

export const StartServerRequestSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  map: MapEntrySchema,
  gslt: z.string(),   // empty on DatHost when the pool is dry, the Hetzner agent refuses an empty token
  password: z.string().min(1),
  allowedSteamIds: z.array(SteamId64Schema).min(1),
  teams: z.array(TeamRosterSchema).length(2),
  webhookUrl: z.url(),
  webhookSecret: z.string().min(16),
  demoUpload: DemoUploadSchema,
  // Built by resolveLaunch from the mode config and map. Drivers launch from this block only
  cs2: Cs2StartSchema,
  // map, cs2 and demoUpload describe the map at series.startMapNumber
  series: SeriesConfigSchema.optional(),
})
export type StartServerRequest = z.infer<typeof StartServerRequestSchema>

export const StartServerResponseSchema = z.object({
  matchId: UuidSchema,
  ip: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  connect: z.string().min(1),
})
export type StartServerResponse = z.infer<typeof StartServerResponseSchema>

export const AgentHealthSchema = z.object({
  ok: z.boolean(),
  cs2Version: z.string(),
  slots: z.object({
    total: z.number().int().nonnegative(),
    free: z.number().int().nonnegative(),
  }),
  updating: z.boolean(),
})
export type AgentHealth = z.infer<typeof AgentHealthSchema>

// Shape of match.json written by the agent and read by the plugin
export const PluginMatchConfigSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  // The map the server starts on. The plugin reads its loadout from here
  map: MapEntrySchema,
  allowedSteamIds: z.array(SteamId64Schema).min(1),
  teams: z.array(TeamRosterSchema).length(2),
  password: z.string().min(1),
  webhookUrl: z.url(),
  webhookSecret: z.string().min(16),
  demoUpload: DemoUploadSchema,
  winCondition: WinConditionSchema,
  series: SeriesConfigSchema.optional(),
})
export type PluginMatchConfig = z.infer<typeof PluginMatchConfigSchema>
