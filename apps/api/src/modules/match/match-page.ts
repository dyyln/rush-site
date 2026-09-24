import { tierForRating, type MatchDetail, type MatchRound, type MatchStatus, type ServerDriverName } from "@rushsite/shared"
import { asc, eq } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matchPlayers, matchRounds, matches, tournaments } from "../../db/schema.js"
import type { UsersService } from "../auth/users.js"
import type { RatingService } from "../rating/service.js"
import { buildRoomView } from "./room-view.js"
import { isSeries, seriesDetail } from "./series.js"
import type { DemoStorage } from "./storage.js"

export type { MatchRound as MatchRoundView, MatchUpdatePayload } from "@rushsite/shared"

// Connect info is added for participants only and is not part of the public schema
export type MatchPage = MatchDetail & {
  connect?: { ip: string; port: number; password: string; connect: string }
}

type RoundRow = typeof matchRounds.$inferSelect

// series adds the map number. Single map matches leave it out
export function roundView(r: RoundRow, series = false): MatchRound {
  return {
    round: r.round,
    winnerTeam: r.winnerTeam,
    score: r.score,
    ...(r.arena ? { arena: r.arena } : {}),
    endedAt: r.endedAt.toISOString(),
    ...(series ? { mapNumber: r.mapNumber } : {}),
  }
}

export function teamScores(teams: { name: string }[], score: Record<string, number> | null): { name: string; score: number }[] {
  return teams.map((t) => ({ name: t.name, score: score?.[t.name] ?? 0 }))
}

const SERVER_STATUSES = new Set(["starting", "ready", "live"])

export async function buildMatchPage(
  deps: { db: Db; users: UsersService; ratings: RatingService; storage?: DemoStorage; now?: () => number },
  matchId: string,
  viewer: string | null,
): Promise<MatchPage | null> {
  const { db } = deps
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId))
  if (!m) return null
  const players = await db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
  const ids = players.map((p) => p.steamId)
  const cards = await deps.users.cards(ids)
  const ratings = await deps.ratings.get(ids, m.mode)
  const rounds = await db
    .select()
    .from(matchRounds)
    .where(eq(matchRounds.matchId, matchId))
    .orderBy(asc(matchRounds.mapNumber), asc(matchRounds.round))
  const series = isSeries(m)
  const scores = teamScores(m.teams, m.score)

  const page: MatchPage = {
    id: m.id,
    ...(m.slug ? { slug: m.slug } : {}),
    mode: m.mode,
    mapId: m.mapId,
    status: m.status as MatchStatus,
    driver: (m.driver as ServerDriverName | null) ?? null,
    startedAt: m.startedAt?.toISOString() ?? null,
    endedAt: m.endedAt?.toISOString() ?? null,
    teams: m.teams.map((t, idx) => ({
      name: t.name,
      ...(t.displayName ? { displayName: t.displayName } : {}),
      score: scores[idx]!.score,
      players: players
        .filter((p) => p.team === idx)
        .map((p) => {
          const r = ratings.get(p.steamId)!.rating
          return {
            steamId: p.steamId,
            displayName: cards.get(p.steamId)?.displayName ?? p.steamId,
            avatarUrl: cards.get(p.steamId)?.avatarUrl ?? null,
            tier: tierForRating(r).id,
            rating: Math.round(r),
            kills: p.kills ?? 0,
            deaths: p.deaths ?? 0,
            headshots: p.headshots ?? 0,
            damage: p.damage ?? 0,
          }
        }),
    })),
    rounds: rounds.map((r) => roundView(r, series)),
    ...(m.source === "challenge" ? { unrated: true } : {}),
  }

  if (series) {
    const lines = new Map(page.teams.flatMap((t) => t.players).map((p) => [p.steamId, p]))
    page.bestOf = m.bestOf ?? 1
    page.maps = await seriesDetail(db, m, lines, deps.storage, deps.now?.() ?? Date.now())
  }

  if (m.tournamentId) {
    const [t] = await db.select({ name: tournaments.name }).from(tournaments).where(eq(tournaments.id, m.tournamentId))
    page.tournament = {
      id: m.tournamentId,
      name: t?.name ?? "",
      bracketMatchId: m.bracketMatchKey ?? "",
      bestOf: m.bestOf ?? 1,
      gameNumber: m.gameNumber ?? 1,
    }
  }

  const participant = !!viewer && ids.includes(viewer)
  if (participant) Object.assign(page, await buildRoomView(db, m, players, viewer))
  if (participant && SERVER_STATUSES.has(m.status) && m.serverIp && m.serverPort && m.connect) {
    page.connect = { ip: m.serverIp, port: m.serverPort, password: m.password ?? "", connect: m.connect }
  }
  return page
}
