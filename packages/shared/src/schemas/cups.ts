import { z } from "zod"
import { ModeSchema } from "./mode.js"
import { TrustLevelSchema } from "./trust.js"

// Team names for 2v2 and 3v3 cup entries. Profanity filtering comes later
export const TEAM_NAME_MIN = 3
export const TEAM_NAME_MAX = 24
export const TeamNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(TEAM_NAME_MIN, `Team name needs at least ${TEAM_NAME_MIN} characters`)
      .max(TEAM_NAME_MAX, `Team name can be at most ${TEAM_NAME_MAX} characters`)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'!?&#-]*$/u, "Use letters, numbers, spaces and . _ ' ! ? & # -"),
  )

// Body of POST /tournaments/:id/enter. teamName is only accepted for team modes
export const EnterTournamentBodySchema = z.object({ teamName: TeamNameSchema.optional() }).optional()
export type EnterTournamentBody = z.infer<typeof EnterTournamentBodySchema>

export const CupScheduleCadenceSchema = z.enum(["daily", "weekly"])
export type CupScheduleCadence = z.infer<typeof CupScheduleCadenceSchema>

// UTC time of day as HH:MM
export const StartTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM in UTC")
export const BestOfFinalSchema = z.union([z.literal(1), z.literal(3), z.literal(5)])
export const CUP_MAX_ENTRANTS = 128
export const MaxEntrantsSchema = z.number().int().min(2).max(CUP_MAX_ENTRANTS)

export const CupScheduleSchema = z.object({
  id: z.string(),
  // Stable key stored on the tournaments this schedule creates
  cupKey: z.string(),
  name: z.string(),
  mode: ModeSchema,
  cadence: CupScheduleCadenceSchema,
  // 0 is Sunday. Only set for weekly schedules
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: StartTimeSchema,
  maxEntrants: MaxEntrantsSchema,
  minTrust: TrustLevelSchema,
  bestOfFinal: BestOfFinalSchema,
  enabled: z.boolean(),
  // ISO start of the next cup this schedule would create. null when disabled
  nextStartsAt: z.string().nullable(),
  updatedAt: z.string(),
})
export type CupSchedule = z.infer<typeof CupScheduleSchema>

const ScheduleFields = z.object({
  name: z.string().trim().min(3).max(60).optional(),
  mode: ModeSchema,
  cadence: CupScheduleCadenceSchema,
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  startTime: StartTimeSchema,
  maxEntrants: MaxEntrantsSchema,
  minTrust: TrustLevelSchema,
  bestOfFinal: BestOfFinalSchema.default(3),
  enabled: z.boolean().default(true),
})

const weeklyNeedsDay = (v: { cadence?: string; weekday?: number | null }) =>
  v.cadence !== "weekly" || (v.weekday !== undefined && v.weekday !== null)

// POST /admin/tournaments/schedules
export const CupScheduleCreateSchema = ScheduleFields.refine(weeklyNeedsDay, {
  message: "Weekly schedules need a weekday",
  path: ["weekday"],
})
export type CupScheduleCreate = z.input<typeof CupScheduleCreateSchema>

// PATCH /admin/tournaments/schedules/:id
export const CupSchedulePatchSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    mode: ModeSchema,
    cadence: CupScheduleCadenceSchema,
    weekday: z.number().int().min(0).max(6).nullable(),
    startTime: StartTimeSchema,
    maxEntrants: MaxEntrantsSchema,
    minTrust: TrustLevelSchema,
    bestOfFinal: BestOfFinalSchema,
    enabled: z.boolean(),
  })
  .partial()
export type CupSchedulePatch = z.infer<typeof CupSchedulePatchSchema>

// POST /admin/tournaments creates a one-off cup
export const CreateCupSchema = z.object({
  mode: ModeSchema,
  name: z.string().trim().min(3).max(60),
  startsAt: z.iso.datetime({ offset: true }),
  maxEntrants: MaxEntrantsSchema,
  minTrust: TrustLevelSchema,
  bestOfFinal: BestOfFinalSchema.default(3),
})
export type CreateCup = z.input<typeof CreateCupSchema>

const AdminReasonSchema = z.string().trim().min(1).max(500)

export const RescheduleCupSchema = z.object({ startsAt: z.iso.datetime({ offset: true }) })
export const CancelCupSchema = z.object({ reason: AdminReasonSchema })
export const DisqualifyEntrySchema = z.object({ reason: AdminReasonSchema })
export const ForceResultSchema = z.object({ winnerEntryId: z.uuid(), reason: AdminReasonSchema })
export const StripBadgesSchema = z.object({ reason: AdminReasonSchema })

// Returned by PATCH and DELETE on a schedule when it is turned off
export const OpenCupOutcomeSchema = z.object({
  tournamentId: z.string(),
  name: z.string(),
  // cancelled when the open cup had no entries, kept otherwise
  action: z.enum(["cancelled", "kept"]),
  entrantCount: z.number().int().nonnegative(),
})
export type OpenCupOutcome = z.infer<typeof OpenCupOutcomeSchema>
