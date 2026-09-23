import { defaultRating, updateRating, updateTeamMatch } from "@rushsite/shared"
import { and, eq, isNotNull } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { matchPlayers, matches, ratingEvents, ratings } from "../../db/schema.js"
import { replayRatings, type ReplayEvent } from "./replay.js"

describe("replayRatings", () => {
  const start = defaultRating()
  const opp = { rating: 1500, rd: 200 }
  const ev = (id: string, score: number): ReplayEvent => ({
    id,
    reason: "match",
    before: start,
    after: start,
    oppRating: opp.rating,
    oppRd: opp.rd,
    score,
  })

  it("matches a straight Glicko-2 run when nothing is voided", () => {
    const events = [ev("1", 1), ev("2", 0), ev("3", 1)]
    let expected = start
    for (const e of events) expected = updateRating(expected, [{ opponent: opp, score: e.score! }])
    expect(replayRatings(start, events, new Set()).final).toEqual(expected)
  })

  it("skips voided events and older rollback entries", () => {
    const events: ReplayEvent[] = [ev("1", 0), { ...ev("r", 0), reason: "rollback" }, ev("2", 1)]
    const expected = updateRating(start, [{ opponent: opp, score: 1 }])
    const out = replayRatings(start, events, new Set(["1"]))
    expect(out.final).toEqual(expected)
    expect(out.steps.map((s) => s.id)).toEqual(["2"])
  })

  it("keeps admin adjustments as a delta", () => {
    const adj: ReplayEvent = { ...ev("a", 0), reason: "adjust", before: { ...start, rating: 1500 }, after: { ...start, rating: 1550 } }
    expect(replayRatings(start, [adj], new Set()).final.rating).toBe(1550)
  })
})

describe("RatingService", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness()
  })
  afterEach(async () => {
    await h.close()
  })

  async function recordMatch(teamA: string[], teamB: string[], winner: 0 | 1) {
    const [m] = await h.db
      .insert(matches)
      .values({
        mode: "aim1v1",
        status: "finished",
        teams: [
          { name: "A", steamIds: teamA },
          { name: "B", steamIds: teamB },
        ],
        webhookSecret: "x".repeat(32),
        createdAt: new Date(h.clock.now()),
      })
      .returning()
    await h.db.insert(matchPlayers).values([
      ...teamA.map((steamId) => ({ matchId: m!.id, steamId, team: 0, won: winner === 0 })),
      ...teamB.map((steamId) => ({ matchId: m!.id, steamId, team: 1, won: winner === 1 })),
    ])
    const changes = await h.ctx.ratings.applyMatch({
      matchId: m!.id,
      mode: "aim1v1",
      teams: [teamA, teamB],
      scoreA: winner === 0 ? 1 : 0,
    })
    h.clock.advance(60_000)
    return { matchId: m!.id, changes }
  }

  it("applies Glicko-2 against the other team's mean and writes before and after", async () => {
    const [a, b, c, d] = await makeUsers(h.db, 4)
    const { matchId, changes } = await recordMatch([a!, b!], [c!, d!], 0)
    const d0 = defaultRating()
    const [[expA]] = updateTeamMatch([d0, d0], [d0, d0], 1)
    expect(changes).toHaveLength(4)
    expect(changes.find((x) => x.steamId === a)!.after).toBeCloseTo(expA!.rating, 6)
    const events = await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))
    expect(events).toHaveLength(4)
    for (const e of events) {
      expect(e.ratingBefore).toBe(1500)
      expect(e.oppRating).toBe(1500)
      expect([0, 1]).toContain(e.score)
    }
    const [row] = await h.db.select().from(ratings).where(eq(ratings.steamId, c!))
    expect(row).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1 })
    expect(row!.rating).toBeLessThan(1500)
  })

  it("rolls back a cheater's wins for the players they beat and replays the rest", async () => {
    const [cheater, victim, other] = await makeUsers(h.db, 3)
    await recordMatch([cheater!], [victim!], 0)
    const { matchId: fair } = await recordMatch([victim!], [other!], 0)
    await recordMatch([victim!], [cheater!], 1)
    const otherBefore = (await h.ctx.ratings.get([other!], "aim1v1")).get(other!)!
    const cheaterBefore = (await h.ctx.ratings.get([cheater!], "aim1v1")).get(cheater!)!

    const summary = await h.ctx.ratings.rollbackCheater(cheater!, new Date(0))
    expect(summary.voidedMatches).toHaveLength(2)
    expect(summary.players).toHaveLength(1)
    expect(summary.players[0]).toMatchObject({ steamId: victim, voidedEvents: 2 })

    const [fairEvent] = await h.db
      .select()
      .from(ratingEvents)
      .where(and(eq(ratingEvents.matchId, fair), eq(ratingEvents.steamId, victim!)))
    const expected = updateRating(defaultRating(), [
      { opponent: { rating: fairEvent!.oppRating!, rd: fairEvent!.oppRd! }, score: 1 },
    ])
    const victimAfter = (await h.ctx.ratings.get([victim!], "aim1v1")).get(victim!)!
    expect(victimAfter.rating).toBeCloseTo(expected.rating, 6)
    expect(victimAfter.rd).toBeCloseTo(expected.rd, 6)

    const [row] = await h.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.steamId, victim!), eq(ratings.mode, "aim1v1")))
    expect(row).toMatchObject({ matchesPlayed: 1, wins: 1, losses: 0 })

    const voided = await h.db.select().from(ratingEvents).where(isNotNull(ratingEvents.voidedAt))
    expect(voided).toHaveLength(2)
    expect(voided.every((v) => v.steamId === victim)).toBe(true)
    const rollbacks = await h.db.select().from(ratingEvents).where(eq(ratingEvents.reason, "rollback"))
    expect(rollbacks).toHaveLength(1)

    // Uninvolved players and the cheater are untouched
    expect((await h.ctx.ratings.get([other!], "aim1v1")).get(other!)).toEqual(otherBefore)
    expect((await h.ctx.ratings.get([cheater!], "aim1v1")).get(cheater!)).toEqual(cheaterBefore)

    // Running it again changes nothing
    const again = await h.ctx.ratings.rollbackCheater(cheater!, new Date(0))
    expect(again.players).toHaveLength(0)
  })

  it("only rolls back wins inside the window", async () => {
    const [cheater, victim] = await makeUsers(h.db, 2)
    await recordMatch([cheater!], [victim!], 0)
    const cutoff = new Date(h.clock.now())
    await recordMatch([cheater!], [victim!], 0)
    const summary = await h.ctx.ratings.rollbackCheater(cheater!, cutoff)
    expect(summary.voidedMatches).toHaveLength(1)
    const [row] = await h.db.select().from(ratings).where(eq(ratings.steamId, victim!))
    expect(row).toMatchObject({ matchesPlayed: 1, losses: 1 })
  })

  it("a ban rolls back and blocks queueing", async () => {
    const [cheater, victim] = await makeUsers(h.db, 2)
    await recordMatch([cheater!], [victim!], 0)
    const res = await h.ctx.bans.ban(cheater!, "aimbot confirmed")
    expect(res.rollback?.players).toHaveLength(1)
    const v = (await h.ctx.ratings.get([victim!], "aim1v1")).get(victim!)!
    expect(v.rating).toBe(1500)
    await expect(h.ctx.queue.join(cheater!, ["aim1v1"])).rejects.toMatchObject({ code: "banned" })
    expect((await h.ctx.trust.levels([cheater!]))[cheater!]).toBe("new")
  })
})
