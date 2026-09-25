import { z } from "zod"
import { MetricPointSchema } from "./admin-ops.js"
import { ModeSchema } from "./mode.js"

// Business dashboards on /admin/metrics. Days are UTC. A point's t is the start of its UTC day or week in epoch ms

export const BUSINESS_DAYS = [7, 30, 90] as const
export type BusinessDays = (typeof BUSINESS_DAYS)[number]

// played: played at least one match that day. any: played or used the site while signed in
export const ActivityKindSchema = z.enum(["played", "any"])
export type ActivityKind = z.infer<typeof ActivityKindSchema>

// GET /admin/metrics/overview and /admin/metrics/queues
export const BusinessRangeQuerySchema = z.object({
  days: z
    .enum(["7", "30", "90"])
    .default("30")
    .transform((d) => Number(d) as BusinessDays),
})

// GET /admin/metrics/retention
export const RetentionQuerySchema = BusinessRangeQuerySchema.extend({
  activity: ActivityKindSchema.default("played"),
  weeks: z.coerce.number().int().min(4).max(26).default(12),
})

const Series = z.array(MetricPointSchema)
const PerMode = z.record(ModeSchema, Series)
// Share from 0 to 1. Null when there is nothing to divide by
const Rate = z.number().nullable()

const RangeHead = {
  days: z.number().int(),
  // First day of the range and the time the numbers were computed, ISO
  from: z.string(),
  to: z.string(),
}

export const BusinessOverviewSchema = z.object({
  ...RangeHead,
  acquisition: z.object({
    totalUsers: z.number().int(),
    newUsers: z.number().int(),
    newPerDay: Series,
    newPerWeek: Series,
    // Users at the end of each day
    cumulative: Series,
  }),
  engagement: z.object({
    // First day with sign in activity on record. Null until anyone signs in after the tracking shipped
    signInTrackedSince: z.string().nullable(),
    dau: Series,
    wau: Series,
    mau: Series,
    // dau over mau per day, 0 to 1
    stickiness: Series,
    // Played or signed in
    dauAny: Series,
    activePlayers: z.number().int(),
    avgDau: z.number(),
    wau7: z.number().int(),
    mau30: z.number().int(),
    avgStickiness: Rate,
    matchesPerDay: PerMode,
    playerMatchesPerDay: Series,
    matches: z.number().int(),
    playerMatches: z.number().int(),
    matchesPerActivePlayer: Rate,
    // Player-matches from the queue where the player queued with at least one friend
    partyShare: Rate,
    bySource: z.object({ queue: z.number().int(), tournament: z.number().int(), challenge: z.number().int() }),
    perMode: z.array(z.object({ mode: ModeSchema, matches: z.number().int(), playerMatches: z.number().int(), players: z.number().int() })),
  }),
  cups: z.object({
    cups: z.number().int(),
    entries: z.number().int(),
    players: z.number().int(),
    avgEntries: z.number().nullable(),
    fillRate: Rate,
    noShowRate: Rate,
    forfeitRate: Rate,
    // Share of cup players who entered two or more cups in the range
    repeatShare: Rate,
    recent: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mode: z.string(),
        startsAt: z.string(),
        status: z.string(),
        entries: z.number().int(),
        maxEntrants: z.number().int(),
        noShows: z.number().int(),
      }),
    ),
  }),
  cost: z.object({
    rates: z.object({ dathostEurPerHour: z.number(), hetznerBoxEurPerMonth: z.number() }),
    hetznerHours: Series,
    dathostHours: Series,
    totals: z.object({
      hetznerHours: z.number(),
      dathostHours: z.number(),
      dathostEur: z.number(),
      hetznerBoxes: z.number().int(),
      hetznerEur: z.number(),
      totalEur: z.number(),
      perMatchEur: z.number().nullable(),
      perPlayerMatchEur: z.number().nullable(),
    }),
    // Nothing is sold yet. Stays null until a revenue source exists
    revenueEur: z.number().nullable(),
  }),
})
export type BusinessOverview = z.infer<typeof BusinessOverviewSchema>

// Counts are players retained. Null means pending: the day or week has not finished for this cohort
export const RetentionViewSchema = z.object({
  ...RangeHead,
  activity: ActivityKindSchema,
  signInTrackedSince: z.string().nullable(),
  daily: z.array(
    z.object({
      cohort: z.string(),
      size: z.number().int(),
      d1: z.number().int().nullable(),
      d7: z.number().int().nullable(),
      d30: z.number().int().nullable(),
    }),
  ),
  // Size weighted over the cohorts that can be measured
  summary: z.object({ d1: Rate, d7: Rate, d30: Rate }),
  // Monday of the signup week. weeks[k] is the players active in week k after it
  weekly: z.array(z.object({ cohort: z.string(), size: z.number().int(), weeks: z.array(z.number().int().nullable()) })),
  // New players by their first match. Week two is days 7 to 13 after it, week four days 21 to 27
  returning: z.object({
    players: z.number().int(),
    weekTwo: z.object({ measured: z.number().int(), returned: z.number().int(), rate: Rate }),
    weekFour: z.object({ measured: z.number().int(), returned: z.number().int(), rate: Rate }),
  }),
})
export type RetentionView = z.infer<typeof RetentionViewSchema>

export const QueueHealthSchema = z.object({
  ...RangeHead,
  // Seconds from joining the queue to the first match found, per ticket
  waits: z.array(
    z.object({ mode: ModeSchema, tickets: z.number().int(), medianSec: z.number().nullable(), p90Sec: z.number().nullable() }),
  ),
  waitPerDay: PerMode,
  // Median per UTC hour of the join time, 24 entries
  waitByHour: z.record(ModeSchema, z.array(z.number().nullable())),
  exits: z.array(
    z.object({ mode: ModeSchema, tickets: z.number().int(), matched: z.number().int(), left: z.number().int(), leftRate: Rate }),
  ),
  accept: z.object({
    matches: z.number().int(),
    passed: z.number().int(),
    prompts: z.number().int(),
    accepted: z.number().int(),
    declined: z.number().int(),
    timedOut: z.number().int(),
    acceptRate: Rate,
    declineRate: Rate,
    timeoutRate: Rate,
  }),
  forfeits: z.object({
    slots: z.number().int(),
    noShows: z.number().int(),
    abandons: z.number().int(),
    noShowRate: Rate,
    abandonRate: Rate,
  }),
  // Daily peaks of players at the same moment
  peaks: z.object({
    queued: Series,
    playing: Series,
    loop: Series,
    loopByMode: PerMode,
    maxLoop: z.number().int(),
    maxLoopByMode: z.record(ModeSchema, z.number().int()),
  }),
  // Player-matches by UTC weekday (0 is Monday) and hour
  heatmap: z.array(z.array(z.number().int())),
})
export type QueueHealth = z.infer<typeof QueueHealthSchema>
