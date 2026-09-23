import { QUEUE_ETA_MIN_SAMPLES, QUEUE_ETA_WINDOW_SEC, type Mode } from "@rushsite/shared"
import { and, eq, gte } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { queueTickets } from "../../db/schema.js"
import type { EtaSource } from "../queue/service.js"

export type TicketWait = { matchId: string | null; enqueuedAt: number; matchedAt: number }

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

// One sample per match, the mean wait of its tickets in seconds. Null below the sample floor
export function estimateFromTickets(tickets: TicketWait[], minSamples = QUEUE_ETA_MIN_SAMPLES): number | null {
  const byMatch = new Map<string, number[]>()
  for (const t of tickets) {
    if (!t.matchId) continue
    const wait = Math.max(0, (t.matchedAt - t.enqueuedAt) / 1000)
    const list = byMatch.get(t.matchId) ?? []
    list.push(wait)
    byMatch.set(t.matchId, list)
  }
  if (byMatch.size < minSamples) return null
  const samples = [...byMatch.values()].map((ws) => ws.reduce((s, w) => s + w, 0) / ws.length)
  return Math.round(median(samples)!)
}

export async function recentTicketWaits(db: Db, mode: Mode, now: number): Promise<TicketWait[]> {
  const since = new Date(now - QUEUE_ETA_WINDOW_SEC * 1000)
  const rows = await db
    .select({ matchId: queueTickets.matchId, enqueuedAt: queueTickets.enqueuedAt, matchedAt: queueTickets.updatedAt })
    .from(queueTickets)
    .where(and(eq(queueTickets.status, "matched"), eq(queueTickets.matchedMode, mode), gte(queueTickets.updatedAt, since)))
  return rows.map((r) => ({ matchId: r.matchId, enqueuedAt: r.enqueuedAt.getTime(), matchedAt: r.matchedAt.getTime() }))
}

// Cached per mode so the queue status broadcast does not query on every call
export function createEtaSource(db: Db, now: () => number, ttlMs = 15_000): EtaSource {
  const cache = new Map<Mode, { at: number; value: number | null }>()
  return async (mode) => {
    const t = now()
    const hit = cache.get(mode)
    if (hit && t - hit.at < ttlMs) return hit.value
    const value = estimateFromTickets(await recentTicketWaits(db, mode, t))
    cache.set(mode, { at: t, value })
    return value
  }
}
