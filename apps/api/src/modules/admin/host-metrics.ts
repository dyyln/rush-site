import type { HostMetricsView, MetricPoint, MetricsRange } from "@rushsite/shared"
import { and, eq, gte, lt, sql } from "drizzle-orm"
import { hostMetrics } from "../../db/schema.js"
import { RANGES } from "./metrics.js"
import type { Db } from "./types.js"

const MINUTE_MS = 60_000
const floorTo = (ms: number, stepMs: number) => Math.floor(ms / stepMs) * stepMs

type Row = { bucket: number; alloc: number | null; cpu: number | null; mem: number | null; load1: number | null }

// Series for one host, averaged in SQL per bucket. Buckets use the same UTC steps as /admin/metrics
export async function hostMetricsView(db: Db, hostId: string, range: MetricsRange, now: Date): Promise<HostMetricsView> {
  const cfg = RANGES[range]
  const stepMs = cfg.stepSec * 1000
  const to = floorTo(floorTo(now.getTime(), MINUTE_MS) + MINUTE_MS - 1, stepMs) + stepMs
  const from = to - Math.ceil(cfg.spanMs / stepMs) * stepMs

  // Inlined so the select and group by render the same expression
  const step = sql.raw(String(Math.trunc(cfg.stepSec)))
  const bucket = sql<number>`(floor(extract(epoch from ${hostMetrics.sampledAt}) / ${step}) * ${step})::float8`
  const rows = (await db
    .select({
      bucket,
      alloc: sql<number | null>`avg(${hostMetrics.allocPct})::float8`,
      cpu: sql<number | null>`avg(${hostMetrics.cpuPct})::float8`,
      mem: sql<number | null>`avg(${hostMetrics.memUsedBytes}::float8 * 100 / nullif(${hostMetrics.memTotalBytes}, 0))::float8`,
      load1: sql<number | null>`avg(${hostMetrics.load1})::float8`,
    })
    .from(hostMetrics)
    .where(and(eq(hostMetrics.hostId, hostId), gte(hostMetrics.sampledAt, new Date(from)), lt(hostMetrics.sampledAt, new Date(to))))
    .groupBy(bucket)) as Row[]

  const byBucket = new Map(rows.map((r) => [Number(r.bucket) * 1000, r]))
  const series = (pick: (r: Row) => number | null, round = 10): MetricPoint[] => {
    const out: MetricPoint[] = []
    for (let t = from; t < to; t += stepMs) {
      const r = byBucket.get(t)
      const v = r ? pick(r) : null
      out.push({ t, v: v === null || v === undefined ? null : Math.round(Number(v) * round) / round })
    }
    return out
  }

  return {
    hostId,
    range,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    stepSec: cfg.stepSec,
    allocPct: series((r) => r.alloc),
    cpuPct: series((r) => r.cpu),
    memPct: series((r) => r.mem),
    load1: series((r) => r.load1, 100),
  }
}
