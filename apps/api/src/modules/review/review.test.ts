import type { MyReport, ReviewFlag, ReviewListResponse } from "@rushsite/shared"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { adminAudit, bans, demos, flags, matchPlayers, matches, ratingEvents, reports, reviews, trustLevels } from "../../db/schema.js"

type H = Awaited<ReturnType<typeof createAppHarness>>

describe("review queue", () => {
  let h: H
  let admin: string
  let other: string

  beforeEach(async () => {
    admin = "76561190000000001"
    other = "76561190000000002"
    h = await createAppHarness({ env: { ADMIN_STEAM_IDS: `${admin},${other}`, TRUST_VERIFIED_MIN_MATCHES: "1" } })
    await h.db.insert((await import("../../db/schema.js")).users).values([
      { steamId: admin, displayName: "admin" },
      { steamId: other, displayName: "admin2" },
    ])
  })
  afterEach(async () => {
    await h.close()
  })

  const cookie = async (steamId: string) => h.app.signCookie(await h.ctx.sessions.create(steamId))

  async function call<T = Record<string, unknown>>(as: string | null, method: "GET" | "POST", url: string, payload?: unknown) {
    const res = await h.app.inject({
      method,
      url,
      ...(as ? { cookies: { rs_sid: await cookie(as) } } : {}),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    })
    return { status: res.statusCode, body: res.json() as T }
  }

  // A finished, rated 2v2. Team A (the suspect's) won
  async function finished2v2() {
    const [suspect, mate, v1, v2] = (await makeUsers(h.db, 4)) as [string, string, string, string]
    const matchId = randomUUID()
    await h.db.insert(matches).values({
      id: matchId,
      mode: "aim2v2",
      status: "finished",
      teams: [
        { name: "A", steamIds: [suspect, mate] },
        { name: "B", steamIds: [v1, v2] },
      ],
      score: { A: 16, B: 3 },
      winnerTeam: "A",
      mapId: "aim_map",
      webhookSecret: "x",
      startedAt: new Date(h.clock.now() - 600_000),
      endedAt: new Date(h.clock.now()),
    })
    await h.db.insert(matchPlayers).values([
      { matchId, steamId: suspect, team: 0, won: true, kills: 30, deaths: 4, headshots: 24, damage: 3000 },
      { matchId, steamId: mate, team: 0, won: true, kills: 10, deaths: 12, headshots: 3, damage: 1200 },
      { matchId, steamId: v1, team: 1, won: false, kills: 8, deaths: 20, headshots: 2, damage: 900 },
      { matchId, steamId: v2, team: 1, won: false, kills: 8, deaths: 20, headshots: 1, damage: 850 },
    ])
    await h.ctx.ratings.applyMatch({ matchId, mode: "aim2v2", teams: [[suspect, mate], [v1, v2]], scoreA: 1 })
    await h.db.insert(demos).values({ matchId, bucket: "b", key: `${matchId}.dem`, uploaded: true })
    return { matchId, suspect, mate, v1, v2 }
  }

  const report = async (as: string, matchId: string, target: string, reason = "aimbot", note?: string) =>
    call(as, "POST", `/matches/${matchId}/report`, { steamId: target, reason, ...(note ? { note } : {}) })

  const flagRows = (steamId: string) => h.db.select().from(flags).where(eq(flags.steamId, steamId))

  describe("auto flag", () => {
    it("does not flag on a single report from a New or Verified player", async () => {
      const { matchId, suspect, v1 } = await finished2v2()
      await h.db.insert(trustLevels).values({ steamId: v1, level: "verified" })
      expect((await report(v1, matchId, suspect)).status).toBe(201)
      expect(await flagRows(suspect)).toHaveLength(0)
    })

    it("flags on the second report against the same player in the same match", async () => {
      const { matchId, suspect, v1, v2 } = await finished2v2()
      await report(v1, matchId, suspect, "aimbot", "snaps to heads")
      expect(await flagRows(suspect)).toHaveLength(0)
      await report(v2, matchId, suspect, "wallhack")
      const rows = await flagRows(suspect)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ matchId, source: "reports", status: "open", detail: { reports: 2, trustedReporter: false } })
      const [demo] = await h.db.select().from(demos).where(eq(demos.matchId, matchId))
      expect(demo!.keep).toBe(true)
    })

    it("counts reports per match, not across matches", async () => {
      const first = await finished2v2()
      const second = await finished2v2()
      await report(first.v1, first.matchId, first.suspect)
      await report(second.v1, second.matchId, second.suspect)
      expect(await flagRows(first.suspect)).toHaveLength(0)
      expect(await flagRows(second.suspect)).toHaveLength(0)
    })

    it("flags on any report from a Trusted player", async () => {
      const { matchId, suspect, v1 } = await finished2v2()
      await h.db.insert(trustLevels).values({ steamId: v1, level: "trusted" })
      await report(v1, matchId, suspect)
      const rows = await flagRows(suspect)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.detail).toMatchObject({ reports: 1, trustedReporter: true })
    })

    it("opens one flag per player per match however many reports arrive", async () => {
      const { matchId, suspect, mate, v1, v2 } = await finished2v2()
      await h.db.insert(trustLevels).values({ steamId: v1, level: "trusted" })
      await report(v1, matchId, suspect)
      await report(v2, matchId, suspect)
      await report(mate, matchId, suspect, "griefing")
      expect(await flagRows(suspect)).toHaveLength(1)
    })
  })

  describe("admin routes", () => {
    async function flagged() {
      const f = await finished2v2()
      await report(f.v1, f.matchId, f.suspect, "aimbot", "snaps to heads")
      await report(f.v2, f.matchId, f.suspect, "wallhack")
      const [row] = await flagRows(f.suspect)
      return { ...f, flagId: row!.id }
    }

    it("hides every route from non admins", async () => {
      const { flagId, v1 } = await flagged()
      expect((await call(null, "GET", "/admin/review")).status).toBe(404)
      expect((await call(v1, "GET", "/admin/review")).status).toBe(404)
      expect((await call(v1, "POST", `/admin/review/${flagId}/claim`)).status).toBe(404)
      expect((await call(v1, "POST", `/admin/review/${flagId}/decide`, { outcome: "cleared", note: "x" })).status).toBe(404)
      expect((await flagRows((await h.db.select().from(flags))[0]!.steamId))[0]!.status).toBe("open")
    })

    it("lists flags with match summary, reports, trust and stats", async () => {
      const { flagId, matchId, suspect, v1, v2 } = await flagged()
      const res = await call<ReviewListResponse>(admin, "GET", "/admin/review?status=open")
      expect(res.status).toBe(200)
      expect(res.body.counts).toEqual({ open: 1, reviewing: 0, cleared: 0, confirmed: 0 })
      const f = res.body.flags[0]!
      expect(f).toMatchObject({ id: flagId, status: "open", reviewer: null, decidedAt: null })
      expect(f.player).toMatchObject({
        steamId: suspect,
        trustLevel: "new",
        banned: false,
        stats: { matches: 1, wins: 1, kills: 30, deaths: 4, headshots: 24, kd: 7.5, headshotPct: 0.8 },
        history: { reportsReceived: 2, flagsConfirmed: 0, flagsCleared: 0 },
      })
      expect(f.player.stats.rating).toBeGreaterThan(1500)
      expect(f.match).toMatchObject({ id: matchId, mode: "aim2v2", mapId: "aim_map", flaggedTeam: 0 })
      expect(f.match!.teams.map((t) => t.score)).toEqual([16, 3])
      expect(f.reports.map((r) => [r.reporter.steamId, r.reason, r.note, r.outcome])).toEqual([
        [v1, "aimbot", "snaps to heads", "received"],
        [v2, "wallhack", null, "received"],
      ])
      expect((await call<ReviewListResponse>(admin, "GET", "/admin/review?status=confirmed")).body.flags).toHaveLength(0)
      expect((await call(admin, "GET", "/admin/review?status=nope")).status).toBe(400)
      expect((await call<{ flag: ReviewFlag }>(admin, "GET", `/admin/review/${flagId}`)).body.flag.id).toBe(flagId)
      expect((await call(admin, "GET", `/admin/review/${randomUUID()}`)).status).toBe(404)
    })

    it("claim moves the flag to reviewing and the reports to reviewed", async () => {
      const { flagId, suspect } = await flagged()
      const res = await call<{ flag: ReviewFlag }>(admin, "POST", `/admin/review/${flagId}/claim`)
      expect(res.status).toBe(200)
      expect(res.body.flag).toMatchObject({ status: "reviewing", reviewer: { steamId: admin } })
      expect(res.body.flag.reports.every((r) => r.outcome === "reviewed")).toBe(true)
      // Claiming again is fine, another admin is refused
      expect((await call(admin, "POST", `/admin/review/${flagId}/claim`)).status).toBe(200)
      const taken = await call(other, "POST", `/admin/review/${flagId}/claim`)
      expect(taken).toMatchObject({ status: 409, body: { error: "already_claimed" } })
      expect((await call(other, "POST", `/admin/review/${flagId}/decide`, { outcome: "cleared", note: "fine" })).status).toBe(409)
      const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.target, flagId))
      expect(audit.map((a) => a.action)).toEqual(["review.claim"])
      expect((await flagRows(suspect))[0]!.reviewerSteamId).toBe(admin)
    })

    it("confirmed bans, rolls back the rating, marks reports actioned and records the label", async () => {
      const { flagId, suspect, v1, v2 } = await flagged()
      await call(admin, "POST", `/admin/review/${flagId}/claim`)
      const beforeV1 = (await h.ctx.ratings.get([v1], "aim2v2")).get(v1)!.rating
      const res = await call<Record<string, unknown> & { flag: ReviewFlag }>(admin, "POST", `/admin/review/${flagId}/decide`, {
        outcome: "confirmed",
        note: "clear aim lock on every duel",
        ban: { reason: "cheating" },
      })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ reportsUpdated: 2, rollback: { voidedMatches: 1 } })
      expect(res.body.banId).toBeTruthy()
      expect(res.body.flag).toMatchObject({ status: "confirmed", note: "clear aim lock on every duel", reviewer: { steamId: admin } })
      expect(res.body.flag.decidedAt).toBe(new Date(h.clock.now()).toISOString())

      const [ban] = await h.db.select().from(bans).where(eq(bans.steamId, suspect))
      expect(ban).toMatchObject({ reason: "cheating", bannedBy: admin, expiresAt: null })
      expect(ban!.rollbackFrom).not.toBeNull()
      // The loss the victims took is undone
      expect((await h.ctx.ratings.get([v1], "aim2v2")).get(v1)!.rating).toBeGreaterThan(beforeV1)
      const voided = await h.db.select().from(ratingEvents).where(and(eq(ratingEvents.steamId, v1), eq(ratingEvents.reason, "match")))
      expect(voided[0]!.voidedAt).not.toBeNull()

      const reps = await h.db.select().from(reports).where(eq(reports.reportedSteamId, suspect))
      expect(reps.map((r) => [r.outcome, r.status])).toEqual([
        ["actioned", "actioned"],
        ["actioned", "actioned"],
      ])
      expect(await h.db.select().from(reviews)).toMatchObject([{ flagId, verdict: "cheat", reviewerSteamId: admin }])
      const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.target, flagId))
      expect(audit.map((a) => a.action).sort()).toEqual(["review.claim", "review.decide"])
      // Deciding twice is refused
      expect((await call(admin, "POST", `/admin/review/${flagId}/decide`, { outcome: "cleared", note: "again" })).status).toBe(409)
      expect((await call<ReviewListResponse>(admin, "GET", "/admin/review?status=confirmed")).body.flags[0]!.player).toMatchObject({
        banned: true,
        history: { flagsConfirmed: 1 },
      })
      void v2
    })

    it("confirmed without a ban still rolls back and a timed ban is kept timed", async () => {
      const a = await flagged()
      const noBan = await call<Record<string, unknown>>(admin, "POST", `/admin/review/${a.flagId}/decide`, { outcome: "confirmed", note: "rolled back only" })
      expect(noBan.status).toBe(200)
      expect(noBan.body).toMatchObject({ banId: null, rollback: { voidedMatches: 1 } })
      expect(await h.db.select().from(bans).where(eq(bans.steamId, a.suspect))).toHaveLength(0)

      const b = await flagged()
      const until = new Date(h.clock.now() + 7 * 86400_000).toISOString()
      const timed = await call<Record<string, unknown>>(admin, "POST", `/admin/review/${b.flagId}/decide`, {
        outcome: "confirmed",
        note: "timed",
        ban: { reason: "cheating", until },
      })
      expect(timed.body).toMatchObject({ rollback: { voidedMatches: 1 } })
      const [ban] = await h.db.select().from(bans).where(eq(bans.steamId, b.suspect))
      expect(ban!.expiresAt!.toISOString()).toBe(until)
    })

    it("cleared dismisses the reports without a ban or rollback", async () => {
      const { flagId, suspect, v1 } = await flagged()
      const beforeV1 = (await h.ctx.ratings.get([v1], "aim2v2")).get(v1)!.rating
      const res = await call<Record<string, unknown> & { flag: ReviewFlag }>(admin, "POST", `/admin/review/${flagId}/decide`, {
        outcome: "cleared",
        note: "good crosshair placement",
      })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ reportsUpdated: 2, banId: null, rollback: null, flag: { status: "cleared" } })
      expect(await h.db.select().from(bans)).toHaveLength(0)
      expect((await h.ctx.ratings.get([v1], "aim2v2")).get(v1)!.rating).toBe(beforeV1)
      const reps = await h.db.select().from(reports).where(eq(reports.reportedSteamId, suspect))
      expect(reps.every((r) => r.outcome === "dismissed" && r.status === "dismissed")).toBe(true)
      expect(await h.db.select().from(reviews)).toMatchObject([{ verdict: "clean" }])
      const [demo] = await h.db.select().from(demos)
      expect(demo!.keep).toBe(false)
    })

    it("the claimer can release a case and others can after the claim goes stale", async () => {
      const { flagId } = await flagged()
      await call(admin, "POST", `/admin/review/${flagId}/claim`)
      expect(await call(other, "POST", `/admin/review/${flagId}/unclaim`)).toMatchObject({ status: 409, body: { error: "already_claimed" } })
      const released = await call<{ flag: ReviewFlag }>(admin, "POST", `/admin/review/${flagId}/unclaim`)
      expect(released.body.flag).toMatchObject({ status: "open", reviewer: null, claimedAt: null })
      expect(released.body.flag.reports.every((r) => r.outcome === "received")).toBe(true)
      expect((await call(admin, "POST", `/admin/review/${flagId}/unclaim`)).body).toMatchObject({ error: "not_claimed" })

      await call(admin, "POST", `/admin/review/${flagId}/claim`)
      h.clock.advance(30 * 60_000)
      const taken = await call<{ flag: ReviewFlag }>(other, "POST", `/admin/review/${flagId}/unclaim`)
      expect(taken.body.flag.status).toBe("open")
      const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.target, flagId))
      expect(audit.map((a) => [a.action, a.adminSteamId])).toEqual([
        ["review.claim", admin],
        ["review.unclaim", admin],
        ["review.claim", admin],
        ["review.unclaim", other],
      ])
    })

    it("any admin may decide a case once the claim is 30 minutes old", async () => {
      const { flagId } = await flagged()
      await call(admin, "POST", `/admin/review/${flagId}/claim`)
      h.clock.advance(29 * 60_000)
      expect((await call(other, "POST", `/admin/review/${flagId}/decide`, { outcome: "cleared", note: "early" })).status).toBe(409)
      h.clock.advance(60_000)
      const res = await call<{ flag: ReviewFlag }>(other, "POST", `/admin/review/${flagId}/decide`, { outcome: "cleared", note: "stale claim" })
      expect(res.status).toBe(200)
      expect(res.body.flag).toMatchObject({ status: "cleared", reviewer: { steamId: other } })
      const [entry] = await h.db.select().from(adminAudit).where(and(eq(adminAudit.target, flagId), eq(adminAudit.action, "review.decide")))
      expect(entry).toMatchObject({ adminSteamId: other, payload: { overrodeClaimOf: admin } })
    })

    it("open and reviewing cases leave the trust level alone, a confirmed one drops it", async () => {
      const { flagId, suspect } = await flagged()
      expect((await h.ctx.trust.recompute(suspect)).level).toBe("verified")
      await call(admin, "POST", `/admin/review/${flagId}/claim`)
      expect((await h.ctx.trust.recompute(suspect)).level).toBe("verified")
      await call(admin, "POST", `/admin/review/${flagId}/decide`, { outcome: "confirmed", note: "cheat" })
      const [row] = await h.db.select().from(trustLevels).where(eq(trustLevels.steamId, suspect))
      expect(row!.level).toBe("new")
    })

    it("validates the decide body", async () => {
      const { flagId } = await flagged()
      const url = `/admin/review/${flagId}/decide`
      expect((await call(admin, "POST", url, { outcome: "banned", note: "x" })).status).toBe(400)
      expect((await call(admin, "POST", url, { outcome: "cleared", note: "" })).status).toBe(400)
      expect((await call(admin, "POST", url, { outcome: "cleared", note: "x", ban: { reason: "no" } })).status).toBe(400)
      const past = new Date(h.clock.now() - 1000).toISOString()
      expect((await call(admin, "POST", url, { outcome: "confirmed", note: "x", ban: { reason: "r", until: past } })).status).toBe(400)
      expect((await call(admin, "POST", `/admin/review/not-a-uuid/decide`, { outcome: "cleared", note: "x" })).status).toBe(404)
      expect((await flagRows((await h.db.select().from(flags))[0]!.steamId))[0]!.status).toBe("open")
    })
  })

  describe("report outcomes", () => {
    it("reporters follow their report from received to actioned", async () => {
      const { matchId, suspect, v1, v2 } = await finished2v2()
      await report(v1, matchId, suspect, "aimbot", "snaps")
      const mine = () => call<{ reports: MyReport[] }>(v1, "GET", `/me/reports?matchId=${matchId}`)
      expect((await mine()).body.reports).toMatchObject([
        { matchId, reported: { steamId: suspect }, reason: "aimbot", note: "snaps", outcome: "received", decidedAt: null, match: { mode: "aim2v2" } },
      ])
      await report(v2, matchId, suspect)
      const [flag] = await flagRows(suspect)
      await call(admin, "POST", `/admin/review/${flag!.id}/claim`)
      expect((await mine()).body.reports[0]!.outcome).toBe("reviewed")
      await call(admin, "POST", `/admin/review/${flag!.id}/decide`, { outcome: "confirmed", note: "cheat", ban: { reason: "cheating" } })
      const done = (await mine()).body.reports[0]!
      expect(done.outcome).toBe("actioned")
      expect(done.decidedAt).toBe(new Date(h.clock.now()).toISOString())
      // The banned player is signed out and anonymous callers are refused
      expect((await call(suspect, "GET", "/me/reports")).status).toBe(401)
      expect((await call(null, "GET", "/me/reports")).status).toBe(401)
    })

    it("lists only the viewer's reports and filters by match", async () => {
      const a = await finished2v2()
      const b = await finished2v2()
      await report(a.v1, a.matchId, a.suspect)
      await report(a.v2, a.matchId, a.mate, "griefing")
      await report(b.v1, b.matchId, b.suspect)
      expect((await call<{ reports: MyReport[] }>(a.v1, "GET", "/me/reports")).body.reports).toHaveLength(1)
      expect((await call<{ reports: MyReport[] }>(a.v1, "GET", `/me/reports?matchId=${b.matchId}`)).body.reports).toHaveLength(0)
      expect((await call(a.v1, "GET", "/me/reports?matchId=nope")).status).toBe(400)
    })

    it("a Trusted report on a cleared case reopens it once", async () => {
      const { matchId, suspect, mate, v1, v2 } = await finished2v2()
      await report(v1, matchId, suspect)
      await report(v2, matchId, suspect)
      const [first] = await flagRows(suspect)
      await call(admin, "POST", `/admin/review/${first!.id}/decide`, { outcome: "cleared", note: "clean" })
      await h.db.insert(trustLevels).values({ steamId: mate, level: "trusted" })
      await report(mate, matchId, suspect, "wallhack", "saw it from spec")
      const rows = (await flagRows(suspect)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      expect(rows.map((r) => r.status)).toEqual(["cleared", "open"])
      expect(rows[1]!.detail).toMatchObject({ reopenedFrom: first!.id, reopenedBy: mate, trustedReporter: true })
      const mine = await call<{ reports: MyReport[] }>(mate, "GET", "/me/reports")
      expect(mine.body.reports[0]).toMatchObject({ outcome: "received", decidedAt: null })
      // The new case carries every report on the player in that match
      const open = await call<ReviewListResponse>(admin, "GET", "/admin/review?status=open")
      expect(open.body.flags[0]!.reports).toHaveLength(3)
      // Confirming it actions every report, including the ones the first ruling dismissed
      await call(admin, "POST", `/admin/review/${rows[1]!.id}/decide`, { outcome: "confirmed", note: "second look" })
      const reps = await h.db.select().from(reports).where(eq(reports.reportedSteamId, suspect))
      expect(reps.every((r) => r.outcome === "actioned")).toBe(true)
      expect((await call<{ reports: MyReport[] }>(v1, "GET", "/me/reports")).body.reports).toHaveLength(1)
    })

    it("late reports follow the decided case", async () => {
      const { matchId, suspect, mate, v1, v2 } = await finished2v2()
      await report(v1, matchId, suspect)
      await report(v2, matchId, suspect)
      const [flag] = await flagRows(suspect)
      await call(admin, "POST", `/admin/review/${flag!.id}/decide`, { outcome: "cleared", note: "clean" })
      await report(mate, matchId, suspect, "griefing")
      const late = await call<{ reports: MyReport[] }>(mate, "GET", "/me/reports")
      expect(late.body.reports[0]!.outcome).toBe("dismissed")
    })
  })
})
