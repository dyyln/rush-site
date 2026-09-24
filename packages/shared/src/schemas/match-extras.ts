import { z } from "zod"
import { MatchDetailSchema } from "./match.js"
import { SteamId64Schema } from "./common.js"

// One kill in GET /matches/:id, ordered by round then tick
export const KillSchema = z.object({
  round: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  attacker: SteamId64Schema,
  victim: SteamId64Schema,
  assister: SteamId64Schema.optional(),
  // Map number inside a series. Left out on single map matches
  mapNumber: z.number().int().positive().optional(),
  weapon: z.string(),
  headshot: z.boolean(),
  wallbang: z.boolean(),
})
export type Kill = z.infer<typeof KillSchema>

// most_damage when damage alone decides it, most_kills when damage ties and kills break it
export const MvpReasonSchema = z.enum(["most_damage", "most_kills"])
export type MvpReason = z.infer<typeof MvpReasonSchema>

export const MatchMvpSchema = z.object({ steamId: SteamId64Schema, reason: MvpReasonSchema })
export type MatchMvp = z.infer<typeof MatchMvpSchema>

// url is a presigned GET that expires at expiresAt
export const MatchDemoSchema = z.object({
  available: z.boolean(),
  url: z.string().optional(),
  expiresAt: z.string().optional(),
})
export type MatchDemo = z.infer<typeof MatchDemoSchema>

// Fields GET /matches/:id adds on top of MatchDetail
export const MatchExtrasSchema = z.object({
  kills: z.array(KillSchema),
  // null until the match is finished with stats
  mvp: MatchMvpSchema.nullable(),
  demo: MatchDemoSchema,
  // Rounded rating change per player. Empty unless the match is finished and rated
  ratingDeltas: z.record(SteamId64Schema, z.number().int()),
  // Players the signed-in viewer already reported in this match. Empty when signed out
  viewerReported: z.array(SteamId64Schema),
})
export type MatchExtras = z.infer<typeof MatchExtrasSchema>

export const MatchDetailWithExtrasSchema = MatchDetailSchema.extend(MatchExtrasSchema.shape)
export type MatchDetailWithExtras = z.infer<typeof MatchDetailWithExtrasSchema>

export const ReportReasonSchema = z.enum(["aimbot", "wallhack", "griefing", "other"])
export type ReportReason = z.infer<typeof ReportReasonSchema>

// Body of POST /matches/:id/report
export const MatchReportBodySchema = z.object({
  steamId: SteamId64Schema,
  reason: ReportReasonSchema,
  note: z.string().trim().max(500).optional(),
})
export type MatchReportBody = z.infer<typeof MatchReportBodySchema>
