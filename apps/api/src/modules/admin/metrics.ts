import { MODES, type MetricPoint, type MetricsRange, type MetricsView, type Mode } from "@rushsite/shared"
import { and, eq, gte, lt, sql } from "drizzle-orm"
import { matches, queueTickets } from "../../db/schema.js"
import { estimateFromTickets } from "../stats/eta.js"
import { metricSamples } from "./schema.js"
import type { Db } from "./types.js"

export const METRIC_RETENTION_MS = 7 * 24 * 3600_000
const MINUTE_MS = 60_000

export type MetricName = "queue_depth" | "matches_found" | "median_wait_sec" | "active_sockets" | "online_users"

export type SampleInput = {
  at: Date
  // Players waiting per mode
  queueDepth: Record<Mode, number>
  activeSockets: number
  // Unique signed in players with an open socket on any instance
  onlineUsers: number
}

export const RANGES: Record<MetricsRange, { spanMs: number; stepSec: number; matchesStepSec: number }> = {
  "1h": { spanMs: 3600_000, stepSec: 60, matchesStepSec: 300 },
  "24h": { spanMs: 24 * 3600_000, stepSec: 600, matchesStepSec: 3600 },
  "7d": { spanMs: 7 * 24 * 3600_000, stepSec: 3600, matchesStepSec: 3600 },
}

const floorTo = (ms: number, stepMs: number) => Math.floor(ms / stepMs) * stepMs

// Writes one row per metric and drops rows past retention. Gauges land on the current minute,
// counts and waits on the minute that just ended.
// Rows are keyed by minute so a second instance sampling the same minute is a no-op.
export async function sampleMetrics(db: Db, input: SampleInput): Promise<{ written: number; pruned: number }> {
  const minute = new Date(floorTo(input.at.getTime(), MINUTE_MS))
  const since = new Date(minute.getTime() - MINUTE_MS)

  const [found, waits] = await Promise.all([
    db
      .select({ mode: matches.mode, n: sql<number>`count(*)::int` })
      .from(matches)
      .where(and(gte(matches.createdAt, since), lt(matches.createdAt, minute)))
      .groupBy(matches.mode),
    db
      .select({
        mode: queueTickets.matchedMode,
        matchId: queueTickets.matchId,
        enqueuedAt: queueTickets.enqueuedAt,
        matchedAt: queueTickets.updatedAt,
      })
      .from(queueTickets)
      .where(and(eq(queueTickets.status, "matched"), gte(queueTickets.updatedAt, since), lt(queueTickets.updatedAt, minute))),
  ])

  const rows: (typeof metricSamples.$inferInsert)[] = []
  const add = (metric: MetricName, mode: Mode | "", value: number, sampledAt = minute) => rows.push({ metric, mode, sampledAt, value })
  for (const mode of MODES) {
    add("queue_depth", mode, input.queueDepth[mode] ?? 0)
    const wait = estimateFromTickets(
      waits
        .filter((w) => w.mode === mode)
        .map((w) => ({ matchId: w.matchId, enqueuedAt: w.enqueuedAt.getTime(), matchedAt: w.matchedAt.getTime() })),
      1,
    )
    if (wait !== null) add("median_wait_sec", mode, wait, since)
  }
  add("matches_found", "", found.reduce((n, r) => n + Number(r.n), 0), since)
  add("active_sockets", "", input.activeSockets)
  add("online_users", "", input.onlineUsers)

  const written = await db.insert(metricSamples).values(rows).onConflictDoNothing().returning({ metric: metricSamples.metric })
  const pruned = await db
    .delete(metricSamples)
    .where(lt(metricSamples.sampledAt, new Date(input.at.getTime() - METRIC_RETENTION_MS)))
    .returning({ metric: metricSamples.metric })
  return { written: written.length, pruned: pruned.length }
}

type BucketRow = { metric: string; mode: string; bucket: number; avg: number; sum: number }

async function buckets(db: Db, from: Date, to: Date, stepSec: number, metricNames: MetricName[]): Promise<BucketRow[]> {
  // Inlined so the select and group by render the same expression
  const step = sql.raw(String(Math.trunc(stepSec)))
  const bucket = sql<number>`(floor(extract(epoch from ${metricSamples.sampledAt}) / ${step}) * ${step})::float8`
  const rows = await db
    .select({
      metric: metricSamples.metric,
      mode: metricSamples.mode,
      bucket,
      avg: sql<number>`avg(${metricSamples.value})::float8`,
      sum: sql<number>`sum(${metricSamples.value})::float8`,
    })
    .from(metricSamples)
    .where(
      and(
        gte(metricSamples.sampledAt, from),
        lt(metricSamples.sampledAt, to),
        sql`${metricSamples.metric} in (${sql.join(
          metricNames.map((m) => sql`${m}`),
          sql`, `,
        )})`,
      ),
    )
    .groupBy(metricSamples.metric, metricSamples.mode, bucket)
  return rows.map((r) => ({ ...r, bucket: Number(r.bucket), avg: Number(r.avg), sum: Number(r.sum) }))
}

function series(rows: BucketRow[], metric: string, mode: string, from: number, to: number, stepMs: number, pick: "avg" | "sum", round = 1): MetricPoint[] {
  const byBucket = new Map<number, number>()
  for (const r of rows) if (r.metric === metric && r.mode === mode) byBucket.set(r.bucket * 1000, r[pick])
  const out: MetricPoint[] = []
  for (let t = from; t < to; t += stepMs) {
    const v = byBucket.get(t)
    out.push({ t, v: v === undefined ? null : Math.round(v * round) / round })
  }
  return out
}

// Series for the admin dashboard. Buckets are aligned to UTC multiples of the step.
export async function metricsView(db: Db, range: MetricsRange, now: Date): Promise<MetricsView> {
  const cfg = RANGES[range]
  const stepMs = cfg.stepSec * 1000
  const mStepMs = cfg.matchesStepSec * 1000
  const to = floorTo(now.getTime(), MINUTE_MS) + MINUTE_MS
  const lineTo = floorTo(to - 1, stepMs) + stepMs
  const lineFrom = lineTo - Math.ceil(cfg.spanMs / stepMs) * stepMs
  const barTo = floorTo(to - 1, mStepMs) + mStepMs
  const barFrom = barTo - Math.ceil(cfg.spanMs / mStepMs) * mStepMs

  const [lines, bars] = await Promise.all([
    buckets(db, new Date(lineFrom), new Date(lineTo), cfg.stepSec, ["queue_depth", "median_wait_sec", "active_sockets", "online_users"]),
    buckets(db, new Date(barFrom), new Date(barTo), cfg.matchesStepSec, ["matches_found"]),
  ])
  const perMode = (metric: MetricName, round: number) =>
    Object.fromEntries(MODES.map((m) => [m, series(lines, metric, m, lineFrom, lineTo, stepMs, "avg", round)])) as Record<Mode, MetricPoint[]>

  return {
    range,
    from: new Date(lineFrom).toISOString(),
    to: new Date(lineTo).toISOString(),
    stepSec: cfg.stepSec,
    queueDepth: perMode("queue_depth", 10),
    medianWaitSec: perMode("median_wait_sec", 1),
    activeSockets: series(lines, "active_sockets", "", lineFrom, lineTo, stepMs, "avg", 10),
    onlineUsers: series(lines, "online_users", "", lineFrom, lineTo, stepMs, "avg", 10),
    matchesFound: series(bars, "matches_found", "", barFrom, barTo, mStepMs, "sum"),
    matchesStepSec: cfg.matchesStepSec,
  }
}
