import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { MapEntrySchema, ModeSchema, WinConditionSchema } from "./mode.js"

export const TeamRosterSchema = z.object({
  name: z.string().min(1),
  steamIds: z.array(SteamId64Schema),
})
export type TeamRoster = z.infer<typeof TeamRosterSchema>

export const DemoUploadSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  presignedPutUrl: z.url(),
})
export type DemoUpload = z.infer<typeof DemoUploadSchema>

export const StartServerRequestSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  map: MapEntrySchema,
  gslt: z.string().min(1),
  password: z.string().min(1),
  allowedSteamIds: z.array(SteamId64Schema).min(1),
  teams: z.array(TeamRosterSchema).length(2),
  webhookUrl: z.url(),
  webhookSecret: z.string().min(16),
  demoUpload: DemoUploadSchema,
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
  allowedSteamIds: z.array(SteamId64Schema).min(1),
  teams: z.array(TeamRosterSchema).length(2),
  password: z.string().min(1),
  webhookUrl: z.url(),
  webhookSecret: z.string().min(16),
  demoUpload: DemoUploadSchema,
  winCondition: WinConditionSchema,
})
export type PluginMatchConfig = z.infer<typeof PluginMatchConfigSchema>
