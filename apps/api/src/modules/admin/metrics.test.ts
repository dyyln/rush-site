import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTestDb, makeUsers } from "../../../test/helpers.js"
import type { Db } from "../../db/client.js"
import { matches, parties, queueTickets } from "../../db/schema.js"
import { METRIC_RETENTION_MS, metricsView, sampleMetrics } from "./metrics.js"
import { metricSamples } from "./schema.js"

const T0 = Date.parse("2026-09-23T12:00:30Z")
const MIN = 60_000
let db: Db

beforeEach(async () => {
  db = (await createTestDb()).db
})
afterEach(() => undefined)

const depth = (aim1v1 = 0, aim2v2 = 0, rush3v3 = 0) => ({ aim1v1, aim2v2, rush3v3, rush1v1: 0 })

async function seedMatch(mode: "aim1v1" | "rush3v3", foundAt: Date, waits: number[]) {
  const startedAt = foundAt
  const ids = await makeUsers(db, waits.length)
  const [m] = await db
    .insert(matches)
    .values({ mode, status: "live", region: "eu", teams: [{ name: "team_a", steamIds: ids }], webhookSecret: "s", createdAt: foundAt })
    .returning()
  const partyRows = await db
    .insert(parties)
    .values(ids.map((id) => ({ leaderSteamId: id, inviteToken: crypto.randomUUID() })))
    .returning()
  await db.insert(queueTickets).values(
    ids.map((id, i) => ({
      partyId: partyRows[i]!.id,
      steamIds: [id],
      modes: [mode],
      ratings: {},
      status: "matched" as const,
      matchId: m!.id,
      matchedMode: mode,
      region: "eu",
      enqueuedAt: new Date(startedAt.getTime() - waits[i]! * 1000),
      updatedAt: startedAt,
    })),
  )
}

describe("metric sampling", () => {
  it("writes gauges, counts and waits once per minute", async () => {
    // Inside the minute that just ended
    await seedMatch("aim1v1", new Date(T0 - 50_000), [40, 60])
    await seedMatch("aim1v1", new Date(T0 - 45_000), [100, 100])
    // Too old to count for this sample
    await seedMatch("rush3v3", new Date(T0 - 3 * MIN), [10])

    const first = await sampleMetrics(db, { at: new Date(T0), queueDepth: depth(3, 0, 6), activeSockets: 12 })
    expect(first.written).toBe(7)
    // The same minute again is a no-op
    expect((await sampleMetrics(db, { at: new Date(T0 + 10_000), queueDepth: depth(9), activeSockets: 1 })).written).toBe(0)

    const rows = await db.select().from(metricSamples)
    const get = (metric: string, mode = "") => rows.find((r) => r.metric === metric && r.mode === mode)
    expect(get("queue_depth", "aim1v1")?.value).toBe(3)
    expect(get("queue_depth", "rush3v3")?.value).toBe(6)
    expect(get("active_sockets")?.value).toBe(12)
    expect(get("matches_found")?.value).toBe(2)
    // Median of the per match mean waits, 50 and 100
    expect(get("median_wait_sec", "aim1v1")?.value).toBe(75)
    expect(get("median_wait_sec", "rush3v3")).toBeUndefined()
    expect(get("queue_depth", "aim1v1")?.sampledAt.toISOString()).toBe("2026-09-23T12:00:00.000Z")
    expect(get("matches_found")?.sampledAt.toISOString()).toBe("2026-09-23T11:59:00.000Z")
  })

  it("drops samples older than seven days", async () => {
    const old = new Date(T0 - METRIC_RETENTION_MS - 5 * MIN)
    const kept = new Date(T0 - METRIC_RETENTION_MS + 5 * MIN)
    await db.insert(metricSamples).values([
      { metric: "active_sockets", mode: "", sampledAt: old, value: 1 },
      { metric: "active_sockets", mode: "", sampledAt: kept, value: 2 },
    ])
    const r = await sampleMetrics(db, { at: new Date(T0), queueDepth: depth(), activeSockets: 0 })
    expect(r.pruned).toBe(1)
    const left = await db.select().from(metricSamples)
    expect(left.some((x) => x.sampledAt.getTime() === old.getTime())).toBe(false)
    expect(left.some((x) => x.sampledAt.getTime() === kept.getTime())).toBe(true)
  })
})

describe("metrics view", () => {
  it("buckets samples per range and leaves gaps as null", async () => {
    for (let i = 0; i < 30; i++) {
      await sampleMetrics(db, { at: new Date(T0 - i * MIN), queueDepth: depth(i % 2 === 0 ? 2 : 4), activeSockets: 10 })
    }
    await db.insert(metricSamples).values({ metric: "matches_found", mode: "", sampledAt: new Date(T0 - 5 * MIN), value: 7 })

    const hour = await metricsView(db, "1h", new Date(T0))
    expect(hour.stepSec).toBe(60)
    expect(hour.queueDepth.aim1v1).toHaveLength(60)
    const filled = hour.queueDepth.aim1v1.filter((p) => p.v !== null)
    expect(filled).toHaveLength(30)
    expect(hour.queueDepth.aim1v1.at(-1)).toEqual({ t: Date.parse("2026-09-23T12:00:00Z"), v: 2 })
    expect(hour.queueDepth.aim1v1[0]!.v).toBeNull()
    expect(hour.activeSockets.at(-1)?.v).toBe(10)
    expect(hour.matchesStepSec).toBe(300)
    expect(hour.matchesFound.reduce((n, p) => n + (p.v ?? 0), 0)).toBe(7)

    const day = await metricsView(db, "24h", new Date(T0))
    expect(day.stepSec).toBe(600)
    expect(day.queueDepth.aim1v1).toHaveLength(144)
    // Mean of alternating 2 and 4 inside a ten minute bucket
    expect(day.queueDepth.aim1v1.filter((p) => p.v !== null).every((p) => p.v! >= 2 && p.v! <= 4)).toBe(true)
    expect(day.matchesStepSec).toBe(3600)
    expect(day.matchesFound).toHaveLength(24)

    const week = await metricsView(db, "7d", new Date(T0))
    expect(week.queueDepth.rush3v3).toHaveLength(168)
  })
})
