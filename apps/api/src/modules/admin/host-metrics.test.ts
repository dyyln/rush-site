import type { AgentHealth } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { hostMetrics, hosts, users } from "../../db/schema.js"
import { HOST_METRICS_RETENTION_MS, pruneHostMetrics } from "../match/host-metrics.js"
import { hostMetricsView } from "./host-metrics.js"

const ROOT = "76561198900000001"
const PLAYER = "76561198900000003"
const AGENT = "http://agent.test:8080"
const MATCH = "3b241101-e2bb-4255-8caf-4136c566a962"
const GB = 1024 ** 3
const MIN = 60_000

const withMetrics: AgentHealth = {
  ok: true,
  cs2Version: "1.41.8.2",
  publicIp: "203.0.113.10",
  slots: { total: 6, free: 4 },
  updating: false,
  metrics: {
    sampledAt: "2026-09-23T12:00:00Z",
    cpuPct: 37.5,
    cpus: 8,
    load: [2.5, 2, 1.5],
    memUsedBytes: 8 * GB,
    memTotalBytes: 32 * GB,
    diskUsedBytes: 90 * GB,
    diskTotalBytes: 450 * GB,
    servers: [{ pid: 4242, port: 27015, matchId: MATCH, cpuPct: 120.5, rssBytes: 4 * GB }],
  },
}

describe("host metrics", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}
  let hostId: string

  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ROOT } })
    await h.db.insert(users).values([
      { steamId: ROOT, displayName: "root" },
      { steamId: PLAYER, displayName: "player" },
    ])
    for (const id of [ROOT, PLAYER]) cookie[id] = h.app.signCookie(await h.ctx.sessions.create(id))
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await h.db.delete(hostMetrics)
    await h.ctx.allocator.syncHosts([AGENT])
    const [row] = await h.db.select().from(hosts).where(eq(hosts.agentUrl, AGENT))
    hostId = row!.id
    await h.db.delete(hostMetrics)
    await h.db.update(hosts).set({ publicIp: null, latestMetrics: null }).where(eq(hosts.id, hostId))
  })

  const get = (id: string, url: string) => h.app.inject({ method: "GET", url, cookies: { rs_sid: cookie[id]! } })

  it("writes one history row per sync and keeps the latest snapshot on the host", async () => {
    h.agent.health_ = withMetrics
    await h.ctx.allocator.syncHosts([AGENT])
    const rows = await h.db.select().from(hostMetrics)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      hostId,
      slotsTotal: 6,
      slotsBusy: 2,
      allocPct: 33.3,
      cpuPct: 37.5,
      load1: 2.5,
      memUsedBytes: 8 * GB,
      memTotalBytes: 32 * GB,
      diskUsedBytes: 90 * GB,
      diskTotalBytes: 450 * GB,
    })
    const [host] = await h.db.select().from(hosts).where(eq(hosts.id, hostId))
    expect(host!.publicIp).toBe("203.0.113.10")
    expect(host!.latestMetrics?.servers).toEqual([{ pid: 4242, port: 27015, matchId: MATCH, cpuPct: 120.5, rssBytes: 4 * GB }])

    // The admin host list shows the live snapshot, with the per server table
    const list = await get(ROOT, "/admin/hosts")
    const view = list.json().hosts.find((x: { id: string }) => x.id === hostId)
    expect(view.publicIp).toBe("203.0.113.10")
    expect(view.metrics.servers[0]).toMatchObject({ port: 27015, matchId: MATCH, cpuPct: 120.5 })

    await h.ctx.allocator.syncHosts([AGENT])
    expect(await h.db.select().from(hostMetrics)).toHaveLength(2)
  })

  it("tracks allocation for an older agent and keeps a stored public IP", async () => {
    await h.db.update(hosts).set({ publicIp: "198.51.100.7" }).where(eq(hosts.id, hostId))
    h.agent.health_ = { ok: true, cs2Version: "1.0", slots: { total: 4, free: 1 }, updating: false }
    await h.ctx.allocator.syncHosts([AGENT])
    const [row] = await h.db.select().from(hostMetrics)
    expect(row).toMatchObject({ allocPct: 75, cpuPct: null, memUsedBytes: null, load1: null })
    const [host] = await h.db.select().from(hosts).where(eq(hosts.id, hostId))
    expect(host!.publicIp).toBe("198.51.100.7")
    expect(host!.latestMetrics).toBeNull()
  })

  it("writes nothing and clears the snapshot when the agent is down", async () => {
    h.agent.health_ = withMetrics
    await h.ctx.allocator.syncHosts([AGENT])
    h.agent.health = async () => {
      throw new Error("unreachable")
    }
    try {
      await h.ctx.allocator.syncHosts([AGENT])
    } finally {
      h.agent.health = async () => h.agent.health_
    }
    expect(await h.db.select().from(hostMetrics)).toHaveLength(1)
    const [host] = await h.db.select().from(hosts).where(eq(hosts.id, hostId))
    expect(host!.status).toBe("offline")
    expect(host!.latestMetrics).toBeNull()
  })

  it("drops rows past retention", async () => {
    const now = new Date(h.clock.now())
    const at = (ms: number) => ({ hostId, sampledAt: new Date(now.getTime() - ms), slotsTotal: 6, slotsBusy: 1, allocPct: 16.7 })
    await h.db.insert(hostMetrics).values([at(HOST_METRICS_RETENTION_MS + MIN), at(HOST_METRICS_RETENTION_MS - MIN), at(MIN)])
    expect(await pruneHostMetrics(h.db, now)).toBe(1)
    expect(await h.db.select().from(hostMetrics)).toHaveLength(2)
  })

  it("averages samples into buckets for long ranges", async () => {
    const now = new Date("2026-09-23T12:00:30Z")
    const hour = Date.parse("2026-09-23T09:00:00Z")
    const row = (t: number, alloc: number, cpu: number | null, memGb: number | null) => ({
      hostId,
      sampledAt: new Date(t),
      slotsTotal: 6,
      slotsBusy: 0,
      allocPct: alloc,
      cpuPct: cpu,
      load1: cpu === null ? null : cpu / 10,
      memUsedBytes: memGb === null ? null : memGb * GB,
      memTotalBytes: memGb === null ? null : 32 * GB,
    })
    await h.db.insert(hostMetrics).values([
      // Three samples inside one hour
      row(hour + 5 * MIN, 0, 10, 8),
      row(hour + 20 * MIN, 50, 20, 16),
      row(hour + 50 * MIN, 100, 60, 24),
      // An older agent in the next hour sends allocation only
      row(hour + 70 * MIN, 50, null, null),
    ])

    const week = await hostMetricsView(h.db, hostId, "7d", now)
    expect(week.stepSec).toBe(3600)
    expect(week.allocPct).toHaveLength(7 * 24)
    expect(week.to).toBe("2026-09-23T13:00:00.000Z")
    const at = (t: number) => week.allocPct.findIndex((p) => p.t === t)
    const i = at(hour)
    expect(week.allocPct[i]!.v).toBe(50)
    expect(week.cpuPct[i]!.v).toBe(30)
    expect(week.memPct[i]!.v).toBe(50)
    expect(week.load1[i]!.v).toBe(3)
    expect(week.allocPct[i + 1]).toEqual({ t: hour + 3600_000, v: 50 })
    expect(week.cpuPct[i + 1]!.v).toBeNull()
    expect(week.memPct[i + 1]!.v).toBeNull()
    // Hours with no samples are gaps
    expect(week.allocPct[i - 1]!.v).toBeNull()

    // The hour range uses minute buckets and leaves out older samples
    const recent = await hostMetricsView(h.db, hostId, "1h", now)
    expect(recent.stepSec).toBe(60)
    expect(recent.allocPct).toHaveLength(60)
    expect(recent.allocPct.every((p) => p.v === null)).toBe(true)

    // Other hosts never leak in
    const other = await hostMetricsView(h.db, "00000000-0000-4000-8000-000000000009", "7d", now)
    expect(other.allocPct.every((p) => p.v === null)).toBe(true)
  })

  it("serves the range query to admins only", async () => {
    await h.db.insert(hostMetrics).values({
      hostId,
      sampledAt: new Date(h.clock.now() - 5 * MIN),
      slotsTotal: 6,
      slotsBusy: 3,
      allocPct: 50,
      cpuPct: 42,
      memUsedBytes: 16 * GB,
      memTotalBytes: 32 * GB,
    })
    const url = `/admin/hosts/${hostId}/metrics?range=24h`
    expect((await get(PLAYER, url)).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url })).statusCode).toBe(404)

    const res = await get(ROOT, url)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ hostId, range: "24h", stepSec: 600 })
    expect(body.allocPct).toHaveLength(144)
    expect(body.allocPct.filter((p: { v: number | null }) => p.v !== null).map((p: { v: number }) => p.v)).toEqual([50])
    expect(body.cpuPct.find((p: { v: number | null }) => p.v !== null).v).toBe(42)
    expect(body.memPct.find((p: { v: number | null }) => p.v !== null).v).toBe(50)

    // Defaults to an hour
    expect((await get(ROOT, `/admin/hosts/${hostId}/metrics`)).json().range).toBe("1h")
    expect((await get(ROOT, `/admin/hosts/${hostId}/metrics?range=30d`)).statusCode).toBe(400)
    expect((await get(ROOT, "/admin/hosts/00000000-0000-4000-8000-000000000009/metrics")).statusCode).toBe(404)
    expect((await get(ROOT, "/admin/hosts/not-a-uuid/metrics")).statusCode).toBe(404)
  })
})
