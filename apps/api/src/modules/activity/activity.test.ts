import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, startDuel, withServers, type Harness } from "../../../test/helpers.js"
import type { Db } from "../../db/client.js"
import { users } from "../../db/schema.js"
import { activityEvents, userActivity } from "./schema.js"
import { SESSION_GAP_MS } from "./service.js"
import { activityOverview, userActivityView } from "./stats.js"

const MIN = 60_000
const DAY = 86_400_000

async function totals(h: Harness, steamId: string) {
  await h.ctx.activity.flush()
  return (await h.db.select().from(userActivity).where(eq(userActivity.steamId, steamId)))[0]
}

async function kinds(h: Harness, steamId: string): Promise<string[]> {
  await h.ctx.activity.flush()
  const rows = await h.db.select().from(activityEvents).where(eq(activityEvents.steamId, steamId)).orderBy(activityEvents.id)
  return rows.map((r) => r.kind)
}

describe("activity recording", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
  })
  afterEach(async () => {
    await h.ctx.activity.flush()
    await h.close()
  })

  it("counts queue joins and the time spent waiting", async () => {
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.queue.join(a!, ["aim1v1"])
    h.clock.advance(90_000)
    await h.ctx.queue.leave(a!)
    const t = await totals(h, a!)
    expect(t).toMatchObject({ queueJoins: 1, queueSeconds: 90, lastAction: "queue_leave", lastActionDetail: "left", lastActionMode: "aim1v1" })
    expect(await kinds(h, a!)).toEqual(["queue_join", "queue_leave"])
  })

  it("follows a match from queue to result", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    await h.ctx.queue.join(a!, ["aim1v1"])
    h.clock.advance(30_000)
    const { matchId } = await startDuel(h, [a!, b!])
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    await h.ctx.flow.handleEvent(matchId, { type: "match_started" })
    h.clock.advance(10 * MIN)
    await h.ctx.flow.handleEvent(matchId, { type: "match_end", winnerTeam: "A", score: { A: 13, B: 4 }, players: [], demoUploaded: false })
    // The result listener writes after the flow returns
    await new Promise((r) => setTimeout(r, 0))

    expect(await kinds(h, a!)).toEqual(["queue_join", "queue_matched", "match_found", "match_accept", "match_start", "match_end"])
    const ta = await totals(h, a!)
    const tb = await totals(h, b!)
    expect(ta).toMatchObject({ queueJoins: 1, queueSeconds: 30, matchesFound: 1, matchesAccepted: 1, matchesPlayed: 1, lastAction: "match_end" })
    expect(ta!.matchesWon + tb!.matchesWon).toBe(1)
    const view = await userActivityView(h.db, a!)
    expect(view.avgWaitSec).toBe(30)
    expect(view.events[0]).toMatchObject({ kind: "match_end", mode: "aim1v1", value: 600 })
  })

  it("records a missed accept", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    await h.ctx.queue.join(a!, ["aim1v1"])
    await h.ctx.queue.join(b!, ["aim1v1"])
    const { matchmakeAll } = await import("../queue/loop.js")
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now())
    await h.ctx.flow.respond(a!, matchId!, true)
    h.clock.advance(MIN)
    await h.ctx.flow.expireAccept(matchId!)
    expect(await totals(h, b!)).toMatchObject({ matchesFound: 1, matchesMissed: 1 })
    // The accepter goes back in the queue. That is not a new join
    expect(await kinds(h, a!)).toEqual(["queue_join", "queue_matched", "match_found", "match_accept", "queue_join"])
    expect(await totals(h, a!)).toMatchObject({ queueJoins: 1, matchesMissed: 0 })
  })

  it("starts a session only after a gap and skips repeat page views", async () => {
    const [a] = await makeUsers(h.db, 1)
    h.ctx.activity.connected(a!)
    await h.ctx.activity.flush()
    h.ctx.activity.pageView(a!, "/play")
    h.ctx.activity.pageView(a!, "/play")
    h.ctx.activity.pageView(a!, "/profile/76561198000000009")
    h.ctx.activity.pageView(a!, "https://elsewhere.example/")
    h.clock.advance(5 * MIN)
    h.ctx.activity.connected(a!)
    await h.ctx.activity.flush()
    h.clock.advance(SESSION_GAP_MS + MIN)
    h.ctx.activity.connected(a!)
    const t = await totals(h, a!)
    expect(t).toMatchObject({ sessions: 2, pageViews: 2, lastPage: "/profile/[steamId]", lastAction: "page_view" })
    expect(t!.lastSeenAt.getTime()).toBe(h.clock.now())
  })
})

describe("activity overview", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness()
  })
  afterEach(async () => {
    await h.close()
  })

  it("sums totals, windows, cohorts and last actions", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    await h.db.update(users).set({ createdAt: new Date(h.clock.now()) })
    await h.ctx.queue.join(a!, ["aim1v1"])
    h.clock.advance(60_000)
    await h.ctx.queue.leave(a!)
    h.ctx.activity.pageView(b!, "/tournaments")
    await h.ctx.activity.flush()
    // b is back 8 days later, a is gone
    h.clock.advance(8 * DAY)
    h.ctx.activity.pageView(b!, "/play")
    await h.ctx.activity.flush()

    const now = new Date(h.clock.now())
    const o = await activityOverview(h.db, now)
    expect(o.totals).toMatchObject({ players: 2, queueJoins: 1, queueSeconds: 60, pageViews: 2 })
    expect(o.windows["24h"]).toMatchObject({ activePlayers: 1, pageViews: 1, queueJoins: 0 })
    expect(o.windows["30d"]).toMatchObject({ activePlayers: 2, queueJoins: 1 })
    expect(o.modes30d).toEqual([expect.objectContaining({ mode: "aim1v1", queueJoins: 1 })])
    expect(o.daily).toHaveLength(30)
    expect(o.daily.at(-1)).toMatchObject({ activePlayers: 1 })
    expect(o.inactivePlayers).toBe(1)
    expect(o.lastActions).toEqual([{ action: "queue_leave", detail: "left", players: 1 }])
    const cohort = o.cohorts.find((c) => c.players > 0)
    expect(cohort?.retention.d7).toEqual({ eligible: 2, returned: 1 })
    expect(cohort?.retention.d30.eligible).toBe(0)
  })
})

describe("activity backfill migration", () => {
  it("rebuilds events and totals from tickets, matches and cup entries", async () => {
    const dir = fileURLToPath(new URL("../../../drizzle", import.meta.url))
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    const pg = new PGlite()
    const run = async (file: string) => {
      for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt)
    }
    const backfill = files.find((f) => f.includes("activity_stats"))!
    for (const f of files.filter((f) => f < backfill)) await run(f)

    const A = "76561198000000101"
    const B = "76561198000000102"
    await pg.exec(`
      insert into users (steam_id, display_name, created_at, last_login_at) values
        ('${A}', 'a', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        ('${B}', 'b', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
      insert into parties (id, leader_steam_id, invite_token) values
        ('11111111-1111-4111-8111-111111111111', '${A}', 'ta'), ('22222222-2222-4222-8222-222222222222', '${B}', 'tb');
      insert into matches (id, mode, status, source, teams, created_at, started_at, ended_at, webhook_secret, password, winner_team)
        values ('33333333-3333-4333-8333-333333333333', 'aim1v1', 'finished', 'queue', '[]', '2026-09-02T00:01:00Z', '2026-09-02T00:05:00Z', '2026-09-02T00:25:00Z', 's', 'p', 'A');
      insert into queue_tickets (party_id, modes, steam_ids, ratings, status, match_id, matched_mode, enqueued_at, updated_at) values
        ('11111111-1111-4111-8111-111111111111', '{aim1v1}', '{${A}}', '{}', 'matched', '33333333-3333-4333-8333-333333333333', 'aim1v1', '2026-09-02T00:00:00Z', '2026-09-02T00:01:00Z'),
        ('22222222-2222-4222-8222-222222222222', '{aim1v1,rush3v3}', '{${B}}', '{}', 'cancelled', null, null, '2026-09-03T00:00:00Z', '2026-09-03T00:02:00Z');
      insert into match_players (match_id, steam_id, team, accepted, won) values
        ('33333333-3333-4333-8333-333333333333', '${A}', 0, true, true);
    `)
    await run(backfill)

    const db = drizzle(pg) as unknown as Db
    const [ta] = await db.select().from(userActivity).where(eq(userActivity.steamId, A))
    expect(ta).toMatchObject({ queueJoins: 1, queueSeconds: 60, matchesFound: 1, matchesAccepted: 1, matchesPlayed: 1, matchesWon: 1, lastAction: "match_end", lastActionDetail: "win" })
    const [tb] = await db.select().from(userActivity).where(eq(userActivity.steamId, B))
    expect(tb).toMatchObject({ queueJoins: 1, queueSeconds: 120, matchesFound: 0, lastAction: "queue_leave", lastActionMode: null })
    const view = await userActivityView(db, A)
    expect(view.events.map((e) => e.kind)).toEqual(["match_end", "match_start", "match_accept", "match_found", "queue_matched", "queue_join"])
  })
})
