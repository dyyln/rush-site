import { z } from "zod"
import { ModeSchema, type Mode } from "./mode.js"

// Feature flags. Keys are dotted lowercase names such as queue.aim1v1.open
export const FlagKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, "lowercase letters, digits, dots, dashes and underscores")
export type FlagKey = z.infer<typeof FlagKeySchema>

export const FeatureFlagSchema = z.object({
  key: FlagKeySchema,
  enabled: z.boolean(),
  value: z.unknown(),
  updatedBy: z.string().nullable(),
  // ISO 8601
  updatedAt: z.string(),
})
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>

// GET /flags. Enabled flags only, key to value
export const PublicFlagsSchema = z.object({ flags: z.record(z.string(), z.unknown()) })
export type PublicFlags = z.infer<typeof PublicFlagsSchema>

// PUT /admin/flags/:key
export const FlagWriteSchema = z.object({
  enabled: z.boolean(),
  value: z.unknown().optional(),
})
export type FlagWrite = z.infer<typeof FlagWriteSchema>

// A mode is open unless this flag exists and is disabled
export function queueOpenFlag(mode: Mode): string {
  return `queue.${mode}.open`
}

// Game servers record and upload demos only while this flag exists and is enabled.
// Server side only, GET /flags leaves it out
export const DEMO_RECORDING_FLAG = "demo.recording"

// GET and PUT /admin/demo-recording. s3Configured says whether demo storage is set up, never where
export const DemoRecordingWriteSchema = z.object({ enabled: z.boolean() })
export type DemoRecordingWrite = z.infer<typeof DemoRecordingWriteSchema>
export type DemoRecordingView = {
  enabled: boolean
  s3Configured: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export const AnnouncementLevelSchema = z.enum(["info", "warn"])
export type AnnouncementLevel = z.infer<typeof AnnouncementLevelSchema>

export const AnnouncementSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  level: AnnouncementLevelSchema,
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  dismissible: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Announcement = z.infer<typeof AnnouncementSchema>

// POST /admin/announcements. startsAt defaults to now, endsAt null runs until removed
export const AnnouncementCreateSchema = z.object({
  text: z.string().trim().min(1).max(500),
  level: AnnouncementLevelSchema.default("info"),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  dismissible: z.boolean().default(true),
})
export type AnnouncementCreate = z.input<typeof AnnouncementCreateSchema>

// PATCH /admin/announcements/:id
export const AnnouncementPatchSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  level: AnnouncementLevelSchema.optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  dismissible: z.boolean().optional(),
})
export type AnnouncementPatch = z.infer<typeof AnnouncementPatchSchema>

// GET /admin/metrics
export const MetricsRangeSchema = z.enum(["1h", "24h", "7d"])
export type MetricsRange = z.infer<typeof MetricsRangeSchema>

// t is the bucket start in epoch ms. v is null when no sample landed in the bucket
export const MetricPointSchema = z.object({ t: z.number(), v: z.number().nullable() })
export type MetricPoint = z.infer<typeof MetricPointSchema>

export const MetricsViewSchema = z.object({
  range: MetricsRangeSchema,
  from: z.string(),
  to: z.string(),
  // Bucket width of the line series
  stepSec: z.number().int().positive(),
  // Players waiting, mean per bucket
  queueDepth: z.record(ModeSchema, z.array(MetricPointSchema)),
  // Median queue wait in seconds of matches made, mean of the minute samples per bucket
  medianWaitSec: z.record(ModeSchema, z.array(MetricPointSchema)),
  // Open websockets, mean per bucket
  activeSockets: z.array(MetricPointSchema),
  // Matches found per bucket of matchesStepSec, every mode together
  matchesFound: z.array(MetricPointSchema),
  matchesStepSec: z.number().int().positive(),
})
export type MetricsView = z.infer<typeof MetricsViewSchema>

// GET /admin/hosts/:id/metrics. Each series is the mean per bucket, null where the host sent nothing
export const HostMetricsViewSchema = z.object({
  hostId: z.string(),
  range: MetricsRangeSchema,
  from: z.string(),
  to: z.string(),
  stepSec: z.number().int().positive(),
  // Busy slots out of total, as a percent
  allocPct: z.array(MetricPointSchema),
  // Whole machine CPU busy percent
  cpuPct: z.array(MetricPointSchema),
  // Memory used out of total, as a percent
  memPct: z.array(MetricPointSchema),
  // 1 minute load average
  load1: z.array(MetricPointSchema),
})
export type HostMetricsView = z.infer<typeof HostMetricsViewSchema>
