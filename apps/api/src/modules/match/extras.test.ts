import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, makeUsers, startDuel, withServers } from "../../../test/helpers.js"
import { matchKills, matches, reports } from "../../db/schema.js"
import type { Env } from "../../env.js"
import { signBody } from "../../lib/hmac.js"
import { computeMvp, DEMO_URL_TTL_SEC } from "./extras.js"
import { DisabledDemoStorage, S3DemoStorage, type DemoStorage } from "./storage.js"

describe("computeMvp", () => {
  const line = (steamId: string, damage: number, kills: number, deaths = 0) => ({ steamId, damage, kills, deaths })

  it("picks the highest damage", () => {
    expect(computeMvp([line("1", 900, 20), line("2", 1200, 5)])).toEqual({ steamId: "2", reason: "most_damage" })
  })

  it("breaks a damage tie on kills", () => {
    expect(computeMvp([line("1", 1000, 8), line("2", 1000, 11)])).toEqual({ steamId: "2", reason: "most_kills" })
  })

  it("falls back to fewer deaths then id, and needs some action", () => {
    expect(computeMvp([line("2", 500, 3, 4), line("1", 500, 3, 4), line("3", 500, 3, 9)])).toEqual({ steamId: "1", reason: "most_damage" })
    expect(computeMvp([line("1", 0, 0), line("2", 0, 0)])).toBeNull()
    expect(computeMvp([])).toBeNull()
  })
})

describe("S3DemoStorage.presignDownload", () => {
  it("signs a GET valid for ten minutes", async () => {
    const env = {
      S3_REGION: "eu-central",
      S3_ENDPOINT: "http://minio:9000",
      S3_PUBLIC_ENDPOINT: "https://files.example",
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_BUCKET: "demos",
    } as unknown as Env
    const url = new URL(await new S3DemoStorage(env).presignDownload("demos/2026-09-23/m.dem", DEMO_URL_TTL_SEC))
    expect(url.origin).toBe("https://files.example")
    expect(url.pathname).toBe("/demos/demos/2026-09-23/m.dem")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600")
    expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="m.dem"')
  })
})

describe("match extras over HTTP", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const disabled = new DisabledDemoStorage()

  beforeAll(async () => {
    h = await createAppHarness({ rng: () => 0 })
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await createTestDb()
    await h.redis.flushall()
    h.notifier.clear()
    h.ctx.storage = disabled
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  })

  async function post(matchId: string, event: unknown) {
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const payload = JSON.stringify({ event })
    return h.app.inject({
      method: "POST",
      url: `/webhooks/match/${matchId}`,
      payload,
      headers: { "content-type": "application/json", "x-rushsite-signature": signBody(payload, m!.webhookSecret) },
    })
  }

  const page = async (matchId: string, cookie?: string) =>
    (await h.app.inject({ method: "GET", url: `/matches/${matchId}`, ...(cookie ? { cookies: { rs_sid: cookie } } : {}) })).json().match

  const cookieFor = async (steamId: string) => h.app.signCookie(await h.ctx.sessions.create(steamId))

  const teamOf = async (matchId: string, steamId: string) =>
    (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.teams.find((t) => t.steamIds.includes(steamId))!.name

  async function liveDuel() {
    const d = await startDuel(h)
    await post(d.matchId, { type: "server_ready" })
    await post(d.matchId, { type: "match_started" })
    return d
  }

  const kill = (round: number, tick: number, attacker: string, victim: string, extra: Record<string, unknown> = {}) => ({
    type: "kill",
    round,
    tick,
    attacker,
    victim,
    weapon: "ak47",
    headshot: false,
    wallbang: false,
    ...extra,
  })

  describe("kills", () => {
    it("stores kills once and ignores players outside the match", async () => {
      const { matchId, a, b } = await liveDuel()
      const [outsider] = await makeUsers(h.db, 1)
      h.notifier.clear()
      expect((await post(matchId, kill(1, 100, a, b, { headshot: true, wallbang: true }))).statusCode).toBe(200)
      expect((await post(matchId, kill(1, 100, a, b, { headshot: true, wallbang: true }))).statusCode).toBe(200)
      expect((await post(matchId, kill(1, 120, outsider!, b))).statusCode).toBe(200)
      expect((await post(matchId, kill(1, 130, a, b, { assister: outsider }))).statusCode).toBe(200)
      expect((await post(matchId, { ...kill(1, 1, a, b), weapon: "" })).statusCode).toBe(400)

      const rows = await h.db.select().from(matchKills).where(eq(matchKills.matchId, matchId))
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.tick === 100)).toMatchObject({ attackerSteamId: a, victimSteamId: b, headshot: true, wallbang: true, assisterSteamId: null })
      expect(rows.find((r) => r.tick === 130)!.assisterSteamId).toBeNull()
      // Kills do not push match_update
      expect(h.notifier.ofType("match_update")).toHaveLength(0)
    })

    it("hides a running round until its round_end, then shows everything once finished", async () => {
      const { matchId, a, b } = await liveDuel()
      const winner = await teamOf(matchId, a)
      const loser = winner === "A" ? "B" : "A"
      await post(matchId, kill(1, 100, a, b, { headshot: true }))
      expect((await page(matchId)).kills).toEqual([])

      await post(matchId, { type: "round_end", round: 1, winnerTeam: winner, score: { [winner]: 1, [loser]: 0 } })
      await post(matchId, kill(2, 900, b, a, { weapon: "awp", wallbang: true }))
      await post(matchId, kill(2, 800, a, b))
      let view = await page(matchId)
      expect(view.kills).toEqual([{ round: 1, tick: 100, attacker: a, victim: b, weapon: "ak47", headshot: true, wallbang: false }])
      expect(view.mvp).toBeNull()
      expect(view.ratingDeltas).toEqual({})
      expect(view.viewerReported).toEqual([])

      await post(matchId, {
        type: "match_end",
        winnerTeam: winner,
        score: { [winner]: 1, [loser]: 0 },
        players: [
          { steamId: a, kills: 2, deaths: 1, headshots: 1, damage: 300 },
          { steamId: b, kills: 1, deaths: 2, headshots: 0, damage: 100 },
        ],
        demoUploaded: false,
      })
      view = await page(matchId)
      expect(view.status).toBe("finished")
      expect(view.kills.map((k: { round: number; tick: number }) => [k.round, k.tick])).toEqual([
        [1, 100],
        [2, 800],
        [2, 900],
      ])
      expect(view.kills[2]).toMatchObject({ attacker: b, weapon: "awp", wallbang: true })
      expect(view.mvp).toEqual({ steamId: a, reason: "most_damage" })
      expect(Object.keys(view.ratingDeltas).sort()).toEqual([a, b].sort())
      expect(view.ratingDeltas[a]).toBeGreaterThan(0)
      expect(view.ratingDeltas[b]).toBeLessThan(0)
      expect(Number.isInteger(view.ratingDeltas[a])).toBe(true)

      // Kills after the match is over are dropped
      await post(matchId, kill(3, 5000, a, b))
      expect(await h.db.select().from(matchKills).where(and(eq(matchKills.matchId, matchId), eq(matchKills.round, 3)))).toHaveLength(0)
    })

    it("keeps match_update unchanged on round_end", async () => {
      const { matchId, a } = await liveDuel()
      const winner = await teamOf(matchId, a)
      h.notifier.clear()
      await post(matchId, kill(1, 10, a, (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!.teams.flatMap((t) => t.steamIds).find((x) => x !== a)!))
      await post(matchId, { type: "round_end", round: 1, winnerTeam: winner, score: { A: winner === "A" ? 1 : 0, B: winner === "B" ? 1 : 0 } })
      const updates = h.notifier.ofType("match_update")
      expect(updates).toHaveLength(1)
      expect(Object.keys(updates[0]!.msg.payload as object).sort()).toEqual(["lastRound", "matchId", "status", "teams"])
    })
  })

  describe("demo", () => {
    class FakeStorage implements DemoStorage {
      readonly enabled = true
      keys: string[] = []
      async presignUpload(matchId: string) {
        return disabled.presignUpload(matchId)
      }
      async upload() {}
      async presignDownload(key: string, ttl: number) {
        this.keys.push(key)
        return `https://files.example/${key}?ttl=${ttl}`
      }
    }

    it("only hands out a link after a good upload", async () => {
      const storage = new FakeStorage()
      h.ctx.storage = storage
      const { matchId, a } = await liveDuel()
      expect((await page(matchId)).demo).toEqual({ available: false })

      await post(matchId, { type: "match_end", winnerTeam: await teamOf(matchId, a), score: { A: 1, B: 0 }, players: [], demoUploaded: false })
      expect((await page(matchId)).demo).toEqual({ available: false })
      await post(matchId, { type: "demo_uploaded", ok: false, error: "timeout" })
      expect((await page(matchId)).demo).toEqual({ available: false })
      expect(storage.keys).toHaveLength(0)

      await post(matchId, { type: "demo_uploaded", ok: true, bytes: 2048 })
      const demo = (await page(matchId)).demo
      expect(demo.available).toBe(true)
      expect(demo.url).toMatch(/^https:\/\/files\.example\/demos\/.+\.dem\?ttl=600$/)
      expect(Date.parse(demo.expiresAt)).toBe(h.clock.now() + DEMO_URL_TTL_SEC * 1000)
    })

    it("stays unavailable when object storage is disabled", async () => {
      const { matchId, a } = await liveDuel()
      await post(matchId, { type: "match_end", winnerTeam: await teamOf(matchId, a), score: { A: 1, B: 0 }, players: [], demoUploaded: false })
      await post(matchId, { type: "demo_uploaded", ok: true, bytes: 2048 })
      expect((await page(matchId)).demo).toEqual({ available: false })
    })
  })

  describe("POST /matches/:id/report", () => {
    const report = (matchId: string, cookie: string | null, payload: unknown) =>
      h.app.inject({ method: "POST", url: `/matches/${matchId}/report`, payload: payload as object, ...(cookie ? { cookies: { rs_sid: cookie } } : {}) })

    it("stores one report per reporter per target per match", async () => {
      const { matchId, a, b } = await liveDuel()
      const sid = await cookieFor(a)
      const res = await report(matchId, sid, { steamId: b, reason: "wallhack", note: "tracks through smoke" })
      expect(res.statusCode).toBe(201)
      expect(res.json().report).toMatchObject({ matchId, steamId: b, reason: "wallhack" })

      const again = await report(matchId, sid, { steamId: b, reason: "aimbot" })
      expect(again.statusCode).toBe(409)
      expect(again.json()).toMatchObject({ error: "already_reported" })

      const rows = await h.db.select().from(reports).where(eq(reports.matchId, matchId))
      expect(rows).toHaveLength(1)
      expect((await page(matchId, sid)).viewerReported).toEqual([b])
      expect((await page(matchId, await cookieFor(b))).viewerReported).toEqual([])
      expect((await page(matchId)).viewerReported).toEqual([])
      expect(rows[0]).toMatchObject({ reporterSteamId: a, reportedSteamId: b, reason: "wallhack", detail: "tracks through smoke", status: "open" })

      // The other side may still report back, and a new match is a new report
      expect((await report(matchId, await cookieFor(b), { steamId: a, reason: "griefing" })).statusCode).toBe(201)
      const otherMatch = "00000000-0000-4000-8000-000000000001"
      await h.db.insert(reports).values({ reporterSteamId: a, reportedSteamId: b, matchId: otherMatch, reason: "wallhack" })
      expect(await h.db.select().from(reports).where(eq(reports.reporterSteamId, a))).toHaveLength(2)
    })

    it("rejects bad reports", async () => {
      const { matchId, a, b } = await liveDuel()
      const [outsider] = await makeUsers(h.db, 1)
      const sid = await cookieFor(a)
      expect((await report(matchId, null, { steamId: b, reason: "aimbot" })).statusCode).toBe(401)
      expect((await report(matchId, sid, { steamId: b, reason: "toxic" })).statusCode).toBe(400)
      expect((await report(matchId, sid, { steamId: a, reason: "aimbot" })).statusCode).toBe(400)
      expect((await report(matchId, sid, { steamId: outsider, reason: "aimbot" })).statusCode).toBe(400)
      expect((await report(matchId, await cookieFor(outsider!), { steamId: b, reason: "aimbot" })).statusCode).toBe(403)
      expect((await report("00000000-0000-4000-8000-000000000000", sid, { steamId: b, reason: "aimbot" })).statusCode).toBe(404)
      expect(await h.db.select().from(reports)).toHaveLength(0)
    })

    it("waits until the match has started", async () => {
      const { matchId, a, b } = await startDuel(h)
      expect((await report(matchId, await cookieFor(a), { steamId: b, reason: "other" })).statusCode).toBe(409)
    })
  })
})
