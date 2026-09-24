import {
  defaultRating,
  isTestMode,
  teamComposite,
  tierForRating,
  updateRating,
  type Glicko2Rating,
  type Mode,
  type RatingChange,
} from "@rushsite/shared"
import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matchPlayers, ratingEvents, ratingRollbacks, ratings } from "../../db/schema.js"
import { replayRatings, type ReplayEvent } from "./replay.js"

export type TeamMatchInput = {
  matchId: string
  mode: Mode
  teams: [string[], string[]]
  // Team 0 result. 1 win, 0.5 draw, 0 loss
  scoreA: number
  // Players recorded as forfeits. They still take the normal loss
  forfeiters?: string[]
  // Players left unrated, such as teammates of a leaver. They still count toward team strength
  exclude?: string[]
  // Challenge matches and test modes are unrated. They still count for history and stats
  source?: string
}

export type RollbackSummary = {
  cheater: string
  voidedMatches: string[]
  players: { steamId: string; mode: Mode; before: number; after: number; voidedEvents: number }[]
}

const toRating = (r: { rating: number; rd: number; volatility: number }): Glicko2Rating => ({
  rating: r.rating,
  rd: r.rd,
  volatility: r.volatility,
})

export class RatingService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async get(steamIds: string[], mode: Mode, db: Db = this.db): Promise<Map<string, Glicko2Rating>> {
    const out = new Map<string, Glicko2Rating>()
    for (const id of steamIds) out.set(id, defaultRating())
    if (steamIds.length === 0) return out
    const rows = await db
      .select()
      .from(ratings)
      .where(and(inArray(ratings.steamId, steamIds), eq(ratings.mode, mode)))
    for (const r of rows) out.set(r.steamId, toRating(r))
    return out
  }

  // Only players with a rating row in the mode. Unrated players are left out
  async ratingValues(steamIds: string[], mode: Mode): Promise<Record<string, number>> {
    if (steamIds.length === 0) return {}
    const rows = await this.db
      .select({ steamId: ratings.steamId, rating: ratings.rating })
      .from(ratings)
      .where(and(inArray(ratings.steamId, steamIds), eq(ratings.mode, mode)))
    return Object.fromEntries(rows.map((r) => [r.steamId, r.rating]))
  }

  private async lockRows(tx: Db, steamIds: string[], mode: Mode): Promise<Map<string, typeof ratings.$inferSelect>> {
    const d = defaultRating()
    await tx
      .insert(ratings)
      .values(steamIds.map((steamId) => ({ steamId, mode, rating: d.rating, rd: d.rd, volatility: d.volatility })))
      .onConflictDoNothing()
    const rows = await tx
      .select()
      .from(ratings)
      .where(and(inArray(ratings.steamId, steamIds), eq(ratings.mode, mode)))
      .orderBy(asc(ratings.steamId))
      .for("update")
    return new Map(rows.map((r) => [r.steamId, r]))
  }

  // Updates every player against the mean of the other team and writes rating_events
  async applyMatch(input: TeamMatchInput, tx: Db = this.db): Promise<RatingChange[]> {
    if (input.source === "challenge" || isTestMode(input.mode)) return []
    const [a, b] = input.teams
    const all = [...a, ...b]
    const rows = await this.lockRows(tx, all, input.mode)
    const cur = (id: string) => toRating(rows.get(id)!)
    const compA = teamComposite(a.map(cur))
    const compB = teamComposite(b.map(cur))
    const forfeit = new Set(input.forfeiters ?? [])
    const exclude = new Set(input.exclude ?? [])
    const changes: RatingChange[] = []
    const now = new Date(this.now())
    for (const [team, opp, score] of [
      [a, compB, input.scoreA],
      [b, compA, 1 - input.scoreA],
    ] as const) {
      for (const steamId of team) {
        if (exclude.has(steamId)) continue
        const before = cur(steamId)
        const after = updateRating(before, [{ opponent: opp, score }])
        await tx.insert(ratingEvents).values({
          matchId: input.matchId,
          steamId,
          mode: input.mode,
          reason: forfeit.has(steamId) ? "forfeit" : "match",
          ratingBefore: before.rating,
          rdBefore: before.rd,
          volBefore: before.volatility,
          ratingAfter: after.rating,
          rdAfter: after.rd,
          volAfter: after.volatility,
          oppRating: opp.rating,
          oppRd: opp.rd,
          score,
          createdAt: now,
        })
        await tx
          .update(ratings)
          .set({
            rating: after.rating,
            rd: after.rd,
            volatility: after.volatility,
            matchesPlayed: sql`${ratings.matchesPlayed} + 1`,
            wins: score === 1 ? sql`${ratings.wins} + 1` : ratings.wins,
            losses: score === 0 ? sql`${ratings.losses} + 1` : ratings.losses,
            updatedAt: now,
          })
          .where(and(eq(ratings.steamId, steamId), eq(ratings.mode, input.mode)))
        changes.push({
          steamId,
          before: before.rating,
          after: after.rating,
          tierBefore: tierForRating(before.rating).id,
          tierAfter: tierForRating(after.rating).id,
        })
      }
    }
    return changes
  }

  // Voids every win the cheater had since `since` for the players they beat, then replays those players.
  // Matches already rolled back are skipped, so a second run or a second cheater in the same match is a no-op.
  // Each victim is replayed over their whole history in the mode so earlier rollbacks stay applied
  async rollbackCheater(cheater: string, since: Date): Promise<RollbackSummary> {
    return this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db
      const wins = await tx
        .select({ matchId: ratingEvents.matchId, mode: ratingEvents.mode })
        .from(ratingEvents)
        .where(
          and(
            eq(ratingEvents.steamId, cheater),
            gte(ratingEvents.createdAt, since),
            eq(ratingEvents.score, 1),
            isNull(ratingEvents.voidedAt),
            inArray(ratingEvents.reason, ["match", "forfeit"]),
          ),
        )
      const candidates = [...new Set(wins.map((w) => w.matchId).filter((m): m is string => !!m))]
      const done =
        candidates.length === 0
          ? []
          : await tx
              .select({ matchId: ratingRollbacks.matchId })
              .from(ratingRollbacks)
              .where(inArray(ratingRollbacks.matchId, candidates))
      const skip = new Set(done.map((d) => d.matchId))
      const matchIds = candidates.filter((m) => !skip.has(m))
      const summary: RollbackSummary = { cheater, voidedMatches: matchIds, players: [] }
      if (matchIds.length === 0) return summary
      const nowDate = new Date(this.now())
      await tx
        .insert(ratingRollbacks)
        .values(matchIds.map((matchId) => ({ matchId, cheaterSteamId: cheater, rolledBackAt: nowDate })))
        .onConflictDoNothing()

      const cheaterTeams = await tx
        .select({ matchId: matchPlayers.matchId, team: matchPlayers.team })
        .from(matchPlayers)
        .where(and(eq(matchPlayers.steamId, cheater), inArray(matchPlayers.matchId, matchIds)))
      const teamOf = new Map(cheaterTeams.map((r) => [r.matchId, r.team]))
      const victims = (
        await tx
          .select({ matchId: matchPlayers.matchId, steamId: matchPlayers.steamId, team: matchPlayers.team })
          .from(matchPlayers)
          .where(and(inArray(matchPlayers.matchId, matchIds), ne(matchPlayers.steamId, cheater)))
      ).filter((v) => teamOf.has(v.matchId) && v.team !== teamOf.get(v.matchId))

      const victimEvents = await tx
        .select()
        .from(ratingEvents)
        .where(
          and(
            inArray(ratingEvents.matchId, matchIds),
            inArray(ratingEvents.steamId, [...new Set(victims.map((v) => v.steamId))]),
            isNull(ratingEvents.voidedAt),
          ),
        )
      const byPlayerMode = new Map<string, typeof victimEvents>()
      for (const ev of victimEvents) {
        const key = `${ev.steamId}|${ev.mode}`
        byPlayerMode.set(key, [...(byPlayerMode.get(key) ?? []), ev])
      }

      for (const [key, voidList] of byPlayerMode) {
        const [steamId, mode] = key.split("|") as [string, Mode]
        const rows = await this.lockRows(tx, [steamId], mode)
        const row = rows.get(steamId)!
        // Replaying only from the newly voided event would restore what an earlier rollback removed
        const history = await tx
          .select()
          .from(ratingEvents)
          .where(and(eq(ratingEvents.steamId, steamId), eq(ratingEvents.mode, mode)))
          .orderBy(asc(ratingEvents.seq))
        const first = history.find((e) => e.reason !== "rollback") ?? voidList[0]!
        const voided = new Set([...voidList.map((e) => e.id), ...history.filter((e) => e.voidedAt).map((e) => e.id)])
        const replayed = replayRatings(
          { rating: first.ratingBefore, rd: first.rdBefore, volatility: first.volBefore },
          history.map(toReplayEvent),
          voided,
        )
        await tx
          .update(ratingEvents)
          .set({ voidedAt: nowDate, voidReason: `rollback:${cheater}` })
          .where(inArray(ratingEvents.id, voidList.map((e) => e.id)))
        await tx.insert(ratingEvents).values({
          matchId: null,
          steamId,
          mode,
          reason: "rollback",
          ratingBefore: row.rating,
          rdBefore: row.rd,
          volBefore: row.volatility,
          ratingAfter: replayed.final.rating,
          rdAfter: replayed.final.rd,
          volAfter: replayed.final.volatility,
          createdAt: nowDate,
        })
        const lossesVoided = voidList.filter((e) => e.score === 0).length
        const winsVoided = voidList.filter((e) => e.score === 1).length
        await tx
          .update(ratings)
          .set({
            rating: replayed.final.rating,
            rd: replayed.final.rd,
            volatility: replayed.final.volatility,
            matchesPlayed: sql`greatest(${ratings.matchesPlayed} - ${voidList.length}, 0)`,
            losses: sql`greatest(${ratings.losses} - ${lossesVoided}, 0)`,
            wins: sql`greatest(${ratings.wins} - ${winsVoided}, 0)`,
            updatedAt: nowDate,
          })
          .where(and(eq(ratings.steamId, steamId), eq(ratings.mode, mode)))
        summary.players.push({
          steamId,
          mode,
          before: row.rating,
          after: replayed.final.rating,
          voidedEvents: voidList.length,
        })
      }
      return summary
    })
  }
}

function toReplayEvent(e: typeof ratingEvents.$inferSelect): ReplayEvent {
  return {
    id: e.id,
    reason: e.reason,
    before: { rating: e.ratingBefore, rd: e.rdBefore, volatility: e.volBefore },
    after: { rating: e.ratingAfter, rd: e.rdAfter, volatility: e.volAfter },
    oppRating: e.oppRating,
    oppRd: e.oppRd,
    score: e.score,
  }
}
