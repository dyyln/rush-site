import type { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAppHarness, createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { queueTickets } from "../../db/schema.js"
import { createEtaSource } from "../stats/eta.js"
import { MODE_STATS_KEY } from "./service.js"

let h: Harness
afterEach(async () => {
  vi.restoreAllMocks()
  await h?.close()
})

function pgClient(db: Harness["db"]): PGlite {
  return (db as unknown as { $client: PGlite }).$client
}

// Counts statements sent to PGlite while fn runs
async function countQueries(db: Harness["db"], fn: () => Promise<unknown>): Promise<number> {
  const client = pgClient(db)
  const q = vi.spyOn(client, "query")
  const e = vi.spyOn(client, "exec")
  await fn()
  const n = q.mock.calls.length + e.mock.calls.length
  q.mockRestore()
  e.mockRestore()
  return n
}

describe("queue join", () => {
  it("keeps one live ticket when the same party joins twice at once", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.parties.ensure(a!)
    const [t1, t2] = await Promise.all([h.ctx.queue.join(a!, ["aim1v1"]), h.ctx.queue.join(a!, ["aim1v1"])])
    expect(t1.id).toBe(t2.id)
    const waiting = await h.db.select().from(queueTickets).where(eq(queueTickets.status, "waiting"))
    expect(waiting).toHaveLength(1)
    expect(await h.redis.zcard("q:aim1v1")).toBe(1)
    expect(await h.ctx.queue.playersInQueue("aim1v1")).toBe(1)
  })

  it("merges modes when concurrent joins ask for different modes", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.parties.ensure(a!)
    await Promise.all([h.ctx.queue.join(a!, ["aim1v1"]), h.ctx.queue.join(a!, ["rush3v3"])])
    const rows = await h.db
      .select()
      .from(queueTickets)
      .where(and(eq(queueTickets.steamIds, [a!]), eq(queueTickets.status, "waiting")))
    expect(rows).toHaveLength(1)
    expect([...rows[0]!.modes].sort()).toEqual(["aim1v1", "rush3v3"])
  })

  it("keeps queue sizes exact across join, rejoin, partial leave and leave", async () => {
    h = await createHarness()
    const [a, b] = await makeUsers(h.db, 2)
    await h.ctx.queue.join(a!, ["aim1v1", "rush3v3"])
    await h.ctx.queue.join(a!, ["aim1v1"])
    await h.ctx.queue.join(b!, ["aim1v1"])
    expect(await h.ctx.queue.playersInQueue("aim1v1")).toBe(2)
    expect(await h.ctx.queue.playersInQueue("rush3v3")).toBe(1)
    await h.ctx.queue.leave(a!, ["rush3v3"])
    expect(await h.ctx.queue.playersInQueue("rush3v3")).toBe(0)
    await h.ctx.queue.leave(a!)
    await h.ctx.queue.leave(a!)
    expect(await h.ctx.queue.playersInQueue("aim1v1")).toBe(1)
  })

  it("does not flag state change messages as refreshes", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.queue.join(a!, ["aim1v1"])
    const sent = h.notifier.ofType("queue_status")
    expect(sent.length).toBeGreaterThan(0)
    for (const s of sent) expect((s.msg.payload as { refresh?: boolean }).refresh).toBeUndefined()
  })
})

describe("queue status refresh", () => {
  it("sends one message per party built from the shared aggregate", async () => {
    h = await createHarness()
    const ids = await makeUsers(h.db, 3)
    for (const id of ids) await h.ctx.queue.join(id, ["aim1v1", "rush3v3"])
    h.notifier.clear()
    const r = await h.ctx.queue.refreshQueued()
    expect(r).toEqual({ tickets: 3, players: 3 })
    const sent = h.notifier.ofType("queue_status")
    expect(sent).toHaveLength(3)
    const payload = sent[0]!.msg.payload as {
      state: string
      refresh?: boolean
      modes: { mode: string; playersInQueue: number; matchesInProgress: number }[]
    }
    expect(payload.state).toBe("queued")
    expect(payload.refresh).toBe(true)
    expect(sent[0]!.audience).toEqual({ kind: "users", steamIds: [expect.any(String)] })
    expect(payload.modes.map((m) => [m.mode, m.playersInQueue, m.matchesInProgress])).toEqual([
      ["aim1v1", 3, 0],
      ["rush3v3", 3, 0],
    ])
    expect(JSON.parse((await h.redis.get("q:agg"))!).modes.aim1v1.playersInQueue).toBe(3)
  })

  it("repairs a drifted size counter", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.queue.join(a!, ["aim1v1"])
    await h.redis.set("q:size:aim1v1", "42")
    await h.ctx.queue.refreshQueued()
    expect(await h.ctx.queue.playersInQueue("aim1v1")).toBe(1)
  })

  it("does not grow its Postgres work with the number of tickets", async () => {
    h = await createHarness()
    const ids = await makeUsers(h.db, 60)
    for (const id of ids.slice(0, 5)) await h.ctx.queue.join(id, ["aim1v1", "aim2v2"])
    // Fresh ETA cache so both passes pay the same per mode cost
    h.ctx.queue.setEtaSource(createEtaSource(h.db, h.ctx.now))
    await h.redis.del("q:agg")
    const small = await countQueries(h.db, () => h.ctx.queue.refreshQueued())

    for (const id of ids.slice(5)) await h.ctx.queue.join(id, ["aim1v1", "aim2v2", "rush3v3"])
    h.ctx.queue.setEtaSource(createEtaSource(h.db, h.ctx.now))
    await h.redis.del("q:agg")
    h.notifier.clear()
    const large = await countQueries(h.db, () => h.ctx.queue.refreshQueued())

    expect(h.notifier.ofType("queue_status")).toHaveLength(60)
    expect(large).toBe(small)
    // Only the ETA reads, one per mode on a cold cache
    expect(large).toBeLessThanOrEqual(3)
    // A warm ETA cache leaves no Postgres work at all
    await h.redis.del("q:agg")
    expect(await countQueries(h.db, () => h.ctx.queue.refreshQueued())).toBe(0)
  })

  it("takes matches in progress from the mode_stats value in Redis", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.queue.join(a!, ["rush3v3"])
    await h.redis.set(
      MODE_STATS_KEY,
      JSON.stringify({ modes: [{ mode: "rush3v3", playersInQueue: 1, matchesInProgress: 7 }] }),
    )
    h.notifier.clear()
    await h.ctx.queue.refreshQueued()
    const payload = h.notifier.ofType("queue_status")[0]!.msg.payload as { modes: { matchesInProgress: number }[] }
    expect(payload.modes[0]!.matchesInProgress).toBe(7)
  })
})

describe("loop metrics", () => {
  it("reports matchmaker and refresh timings on /health", async () => {
    const a = await createAppHarness()
    try {
      const body = (await a.app.inject({ method: "GET", url: "/health" })).json()
      expect(body.loops).toEqual({
        matchmaker: { lastMs: null, maxMs: null },
        refresh: { lastMs: null, maxMs: null },
      })
    } finally {
      await a.close()
    }
  })
})

describe("queue join while the party changes", () => {
  it("rejects with party_changed when a member joins mid queue", async () => {
    h = await createHarness()
    const [leader, member] = await makeUsers(h.db, 2)
    const party = await h.ctx.parties.ensure(leader!)
    const realGet = h.ctx.ratings.get.bind(h.ctx.ratings)
    let joined = false
    vi.spyOn(h.ctx.ratings, "get").mockImplementation(async (...args) => {
      // The member arrives after the leader's roster was read but before the ticket exists
      if (!joined) {
        joined = true
        await h.ctx.parties.join(member!, party.inviteToken)
      }
      return realGet(...args)
    })
    await expect(h.ctx.queue.join(leader!, ["aim1v1"])).rejects.toMatchObject({ statusCode: 409, code: "party_changed" })
    const waiting = await h.db.select().from(queueTickets).where(eq(queueTickets.status, "waiting"))
    expect(waiting).toHaveLength(0)
    expect(await h.redis.zcard("q:aim1v1")).toBe(0)
    expect(await h.ctx.queue.playersInQueue("aim1v1")).toBe(0)
    expect((await h.ctx.queue.status(leader!)).state).toBe("idle")
  })
})
