import { z } from "zod"
import { PlayerCardSchema, UuidSchema } from "./common.js"
import { MatchStatusSchema } from "./match.js"
import { ReportReasonSchema } from "./match-extras.js"
import { ModeSchema } from "./mode.js"
import { TrustLevelSchema } from "./trust.js"

// open until an admin claims it, reviewing while claimed, cleared or confirmed once decided
export const FlagStatusSchema = z.enum(["open", "reviewing", "cleared", "confirmed"])
export type FlagStatus = z.infer<typeof FlagStatusSchema>
export const FLAG_STATUSES = FlagStatusSchema.options

// What a reporter sees. reviewed means a reviewer has the case
export const ReportOutcomeSchema = z.enum(["received", "reviewed", "actioned", "dismissed"])
export type ReportOutcome = z.infer<typeof ReportOutcomeSchema>

// Reports from this many players on one target in one match open a flag
export const AUTO_FLAG_MIN_REPORTS = 2

export const CLAIM_TIMEOUT_MINUTES = 30

export const ReviewReportSchema = z.object({
  id: UuidSchema,
  reporter: PlayerCardSchema.extend({ trustLevel: TrustLevelSchema }),
  reason: ReportReasonSchema,
  note: z.string().nullable(),
  outcome: ReportOutcomeSchema,
  createdAt: z.string(),
})
export type ReviewReport = z.infer<typeof ReviewReportSchema>

export const ReviewMatchPlayerSchema = PlayerCardSchema.extend({
  kills: z.number().nullable(),
  deaths: z.number().nullable(),
  headshots: z.number().nullable(),
  damage: z.number().nullable(),
})
export type ReviewMatchPlayer = z.infer<typeof ReviewMatchPlayerSchema>

export const ReviewMatchSchema = z.object({
  id: UuidSchema,
  mode: ModeSchema,
  mapId: z.string().nullable(),
  status: MatchStatusSchema,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  // Index into teams of the flagged player's team
  flaggedTeam: z.number().int().nullable(),
  teams: z.array(z.object({ name: z.string(), score: z.number(), players: z.array(ReviewMatchPlayerSchema) })),
})
export type ReviewMatch = z.infer<typeof ReviewMatchSchema>

// Career numbers over finished matches in every mode
export const ReviewPlayerStatsSchema = z.object({
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  // null with no kills or deaths
  kd: z.number().nullable(),
  headshotPct: z.number().nullable(),
  // Rating in the flagged match's mode. null when unrated there
  rating: z.number().nullable(),
})
export type ReviewPlayerStats = z.infer<typeof ReviewPlayerStatsSchema>

export const ReviewPlayerSchema = PlayerCardSchema.extend({
  trustLevel: TrustLevelSchema,
  banned: z.boolean(),
  stats: ReviewPlayerStatsSchema,
  history: z.object({
    reportsReceived: z.number().int().nonnegative(),
    flagsConfirmed: z.number().int().nonnegative(),
    flagsCleared: z.number().int().nonnegative(),
  }),
})
export type ReviewPlayer = z.infer<typeof ReviewPlayerSchema>

export const ReviewFlagSchema = z.object({
  id: UuidSchema,
  status: FlagStatusSchema,
  // reports, or a later source such as heuristics
  source: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  reviewer: PlayerCardSchema.nullable(),
  // Set while claimed. After CLAIM_TIMEOUT_MINUTES any admin may release or decide it
  claimedAt: z.string().nullable(),
  note: z.string().nullable(),
  player: ReviewPlayerSchema,
  match: ReviewMatchSchema.nullable(),
  reports: z.array(ReviewReportSchema),
})
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>

// GET /admin/review?status=
export const ReviewListResponseSchema = z.object({
  flags: z.array(ReviewFlagSchema),
  counts: z.record(FlagStatusSchema, z.number().int().nonnegative()),
})
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>

// Body of POST /admin/review/:flagId/decide
export const ReviewDecideBodySchema = z.object({
  outcome: z.enum(["cleared", "confirmed"]),
  note: z.string().trim().min(1).max(1000),
  // Only with confirmed. until is ISO, missing or null is permanent
  ban: z
    .object({
      reason: z.string().trim().min(1).max(500),
      until: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .optional(),
})
export type ReviewDecideBody = z.infer<typeof ReviewDecideBodySchema>

export const ReviewDecideResponseSchema = z.object({
  flag: ReviewFlagSchema,
  reportsUpdated: z.number().int().nonnegative(),
  banId: z.string().nullable(),
  // Rating rollback applied on confirmed
  rollback: z.object({ voidedMatches: z.number().int().nonnegative(), playersAdjusted: z.number().int().nonnegative() }).nullable(),
})
export type ReviewDecideResponse = z.infer<typeof ReviewDecideResponseSchema>

// One row of GET /me/reports
export const MyReportSchema = z.object({
  id: UuidSchema,
  matchId: UuidSchema.nullable(),
  reported: PlayerCardSchema,
  reason: ReportReasonSchema,
  note: z.string().nullable(),
  outcome: ReportOutcomeSchema,
  createdAt: z.string(),
  // When the case was decided. null until then
  decidedAt: z.string().nullable(),
  match: z.object({ mode: ModeSchema, mapId: z.string().nullable(), endedAt: z.string().nullable() }).nullable(),
})
export type MyReport = z.infer<typeof MyReportSchema>

export const MyReportsResponseSchema = z.object({ reports: z.array(MyReportSchema) })
export type MyReportsResponse = z.infer<typeof MyReportsResponseSchema>

export const MyReportsQuerySchema = z.object({
  matchId: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
