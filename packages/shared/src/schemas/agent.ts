import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { Cs2StartSchema, MapEntrySchema, ModeSchema, WinConditionSchema } from "./mode.js"
import { MatchSlugSchema } from "../match-slug.js"

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

// Written into match.json in place of demoUpload when recording is off.
// Older plugins require the field and accept an empty upload url
export const BLANK_DEMO_UPLOAD = { bucket: "", key: "", presignedPutUrl: "" } as const
const BlankDemoUploadSchema = z.object({ bucket: z.literal(""), key: z.literal(""), presignedPutUrl: z.literal("") })

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
    // One upload per map, index is mapNumber - 1. Left out when recordDemo is false
    demoUploads: z.array(DemoUploadSchema).min(2).optional(),
  })
  .refine((s) => s.maps.length === s.bestOf && (!s.demoUploads || s.demoUploads.length === s.bestOf), "maps and demoUploads need bestOf entries")
  .refine((s) => s.startMapNumber <= s.bestOf, "startMapNumber is past the last map")
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>

// Seven room ids in slot order
export const RushRoomsSchema = z.array(z.number().int().positive()).length(7)

// Brand shown by the plugin. name is the chat prefix and siteUrl is the web root for the match link
export const MatchBrandSchema = z.object({
  name: z.string().min(1).max(24),
  siteUrl: z.url(),
})
export type MatchBrand = z.infer<typeof MatchBrandSchema>

export const StartServerRequestSchema = z
  .object({
    matchId: UuidSchema,
    mode: ModeSchema,
    map: MapEntrySchema,
    gslt: z.string(), // empty on DatHost when the pool is dry, the Hetzner agent refuses an empty token
    password: z.string().min(1),
    allowedSteamIds: z.array(SteamId64Schema).min(1),
    teams: z.array(TeamRosterSchema).length(2),
    webhookUrl: z.url(),
    webhookSecret: z.string().min(16),
    // False turns off tv_record and the upload for every map. Absent means record, for older senders
    recordDemo: z.boolean().optional(),
    // Required unless recordDemo is false
    demoUpload: DemoUploadSchema.optional(),
    // Built by resolveLaunch from the mode config and map. Drivers launch from this block only
    cs2: Cs2StartSchema,
    // map, cs2 and demoUpload describe the map at series.startMapNumber
    series: SeriesConfigSchema.optional(),
    // Rush room ids from the room veto, T castle first. Passed through to match.json
    rushRooms: RushRoomsSchema.optional(),
    // Passed through to match.json for the chat prefix and the match link at siteUrl/matches/<slug>
    brand: MatchBrandSchema.optional(),
    slug: MatchSlugSchema.optional(),
  })
  .refine((r) => r.recordDemo === false || !!r.demoUpload, "demoUpload is required when recording")
  .refine((r) => r.recordDemo === false || !r.series || !!r.series.demoUploads, "series.demoUploads is required when recording")
export type StartServerRequest = z.infer<typeof StartServerRequestSchema>

export const StartServerResponseSchema = z.object({
  matchId: UuidSchema,
  ip: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  connect: z.string().min(1),
})
export type StartServerResponse = z.infer<typeof StartServerResponseSchema>

const bytes = z.number().nonnegative()

// One running CS2 process as the agent reads it from /proc
export const AgentServerMetricsSchema = z.object({
  pid: z.number().int().nonnegative(),
  port: z.number().int(),
  matchId: z.string(),
  // Percent of one core, like top. Two full cores read 200
  cpuPct: z.number().nonnegative().optional(),
  rssBytes: bytes.optional(),
})
export type AgentServerMetrics = z.infer<typeof AgentServerMetricsSchema>

// Machine usage from GET /health. Every number is left out when the agent could not read it
export const AgentHostMetricsSchema = z.object({
  sampledAt: z.string(),
  // Whole machine busy percent, 0 to 100 across every core
  cpuPct: z.number().min(0).max(100).optional(),
  cpus: z.number().int().positive().optional(),
  // 1, 5 and 15 minute load averages
  load: z.array(z.number().nonnegative()).length(3).optional(),
  // Used is total minus MemAvailable
  memUsedBytes: bytes.optional(),
  memTotalBytes: bytes.optional(),
  // The filesystem holding the CS2 install
  diskUsedBytes: bytes.optional(),
  diskTotalBytes: bytes.optional(),
  servers: z.array(AgentServerMetricsSchema).default([]),
})
export type AgentHostMetrics = z.infer<typeof AgentHostMetricsSchema>

export const AgentHealthSchema = z.object({
  ok: z.boolean(),
  cs2Version: z.string(),
  // RUSHSITE_PUBLIC_IP. Absent from older agents. A bad value is dropped rather than failing the check
  publicIp: z.string().min(1).max(64).optional().catch(undefined),
  slots: z.object({
    total: z.number().int().nonnegative(),
    free: z.number().int().nonnegative(),
  }),
  updating: z.boolean(),
  // Absent from older agents and off Linux. A malformed block is dropped so the host still counts as up
  metrics: AgentHostMetricsSchema.optional().catch(undefined),
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
  // False means no demo is recorded or uploaded. Absent means record
  recordDemo: z.boolean().optional(),
  // Blank when recordDemo is false
  demoUpload: z.union([DemoUploadSchema, BlankDemoUploadSchema]),
  winCondition: WinConditionSchema,
  series: SeriesConfigSchema.optional(),
  // The plugin ignores this until the server can load chosen rooms
  rushRooms: RushRoomsSchema.optional(),
  brand: MatchBrandSchema.optional(),
  slug: MatchSlugSchema.optional(),
})
export type PluginMatchConfig = z.infer<typeof PluginMatchConfigSchema>
