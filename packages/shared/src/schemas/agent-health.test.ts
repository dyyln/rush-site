import { describe, expect, it } from "vitest"
import { AgentHealthSchema } from "./index.js"

const MATCH = "3b241101-e2bb-4255-8caf-4136c566a962"
const base = { ok: true, cs2Version: "1.41.8.2", slots: { total: 6, free: 4 }, updating: false }

describe("AgentHealthSchema", () => {
  it("accepts an older agent without metrics", () => {
    const h = AgentHealthSchema.parse(base)
    expect(h.metrics).toBeUndefined()
    expect(h.slots).toEqual({ total: 6, free: 4 })
  })

  it("reads publicIp when the agent sends it", () => {
    expect(AgentHealthSchema.parse(base).publicIp).toBeUndefined()
    expect(AgentHealthSchema.parse({ ...base, publicIp: "203.0.113.10" }).publicIp).toBe("203.0.113.10")
    // A bad value is dropped, the rest still parses
    const h = AgentHealthSchema.parse({ ...base, publicIp: 42 })
    expect(h.publicIp).toBeUndefined()
    expect(h.ok).toBe(true)
  })

  it("ignores fields it does not know, such as update", () => {
    const h = AgentHealthSchema.parse({ ...base, update: { state: "idle", attempts: 0 } })
    expect(h).not.toHaveProperty("update")
  })

  it("reads the metrics block from a newer agent", () => {
    const body = {
      ...base,
      metrics: {
        sampledAt: "2026-09-26T12:00:00Z",
        cpuPct: 41.5,
        cpus: 8,
        load: [2.15, 1.8, 1.42],
        memUsedBytes: 12_582_912_000,
        memTotalBytes: 33_554_432_000,
        diskUsedBytes: 80e9,
        diskTotalBytes: 500e9,
        servers: [
          { pid: 4242, port: 27015, matchId: MATCH, cpuPct: 135.2, rssBytes: 4_294_967_296 },
          // A process that vanished between listing and reading proc
          { pid: 5151, port: 27016, matchId: MATCH },
        ],
      },
    }
    const h = AgentHealthSchema.parse(body)
    expect(h.metrics?.cpuPct).toBe(41.5)
    expect(h.metrics?.load).toEqual([2.15, 1.8, 1.42])
    expect(h.metrics?.servers).toHaveLength(2)
    expect(h.metrics?.servers[0]?.cpuPct).toBe(135.2)
    expect(h.metrics?.servers[1]?.rssBytes).toBeUndefined()
  })

  it("accepts a metrics block with every number missing", () => {
    const h = AgentHealthSchema.parse({ ...base, metrics: { sampledAt: "2026-09-26T12:00:00Z", servers: [] } })
    expect(h.metrics).toEqual({ sampledAt: "2026-09-26T12:00:00Z", servers: [] })
    // Servers default to an empty list
    expect(AgentHealthSchema.parse({ ...base, metrics: { sampledAt: "x" } }).metrics?.servers).toEqual([])
  })

  it("drops a malformed metrics block instead of failing the whole health check", () => {
    const h = AgentHealthSchema.parse({ ...base, metrics: { sampledAt: "x", cpuPct: "busy", servers: [] } })
    expect(h.ok).toBe(true)
    expect(h.metrics).toBeUndefined()
  })

  it("still rejects a health body without its required fields", () => {
    expect(AgentHealthSchema.safeParse({ ok: true, metrics: { sampledAt: "x", servers: [] } }).success).toBe(false)
  })
})
