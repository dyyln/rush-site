import type { AgentHealth } from "@rushsite/shared"
import { lt } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { hostMetrics } from "../../db/schema.js"

export const HOST_METRICS_RETENTION_MS = 14 * 24 * 3600_000

// The history row for one health check. Older agents send no metrics, so only allocation is filled
export function hostMetricsRow(hostId: string, at: Date, h: AgentHealth): typeof hostMetrics.$inferInsert {
  const total = h.slots.total
  const busy = Math.max(0, total - h.slots.free)
  const m = h.metrics
  return {
    hostId,
    sampledAt: at,
    slotsTotal: total,
    slotsBusy: busy,
    allocPct: total > 0 ? Math.round((busy / total) * 1000) / 10 : null,
    cpuPct: m?.cpuPct ?? null,
    load1: m?.load?.[0] ?? null,
    memUsedBytes: m?.memUsedBytes ?? null,
    memTotalBytes: m?.memTotalBytes ?? null,
    diskUsedBytes: m?.diskUsedBytes ?? null,
    diskTotalBytes: m?.diskTotalBytes ?? null,
  }
}

export async function recordHostMetrics(db: Db, hostId: string, at: Date, h: AgentHealth): Promise<void> {
  await db.insert(hostMetrics).values(hostMetricsRow(hostId, at, h)).onConflictDoNothing()
}

// Deletes history past retention. Returns how many rows went
export async function pruneHostMetrics(db: Db, now: Date): Promise<number> {
  const gone = await db
    .delete(hostMetrics)
    .where(lt(hostMetrics.sampledAt, new Date(now.getTime() - HOST_METRICS_RETENTION_MS)))
    .returning({ hostId: hostMetrics.hostId })
  return gone.length
}
