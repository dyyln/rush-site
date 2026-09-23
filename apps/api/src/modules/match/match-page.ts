import { tierForRating, type Mode, type TierId } from "@rushsite/shared"
import { asc, eq } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matchPlayers, matchRounds, matches, tournaments } from "../../db/schema.js"
import type { UsersService } from "../auth/users.js"
import type { RatingService } from "../rating/service.js"

// Local copies of the match page shapes in CONTRACTS.md until shared exports them

export type MatchRoundView = {
  round: number
  winnerTeam: string
  score: Record<string, number>
  arena?: string
  endedAt: string
}

export type MatchUpdatePayload = {
  matchId: string
  status: string
  teams: { name: string; score: number }[]
  lastRound?: MatchRoundView
}

export type MatchPagePlayer = {
  steamId: string
  displayName: string
  avatarUrl: string | null
  tier: TierId
  rating: number
  kills: number | null
  deaths: number | null
  headshots: number | null
  damage: number | null
}

export type MatchPage = {
  id: string
  mode: Mode
  mapId: string | null
  status: string
  driver: string | null
  startedAt: string | null
  endedAt: string | null
  teams: { name: string; score: number; players: MatchPagePlayer[] }[]
  rounds: MatchRoundView[]
  tournament?: { id: string; name: string; bracketMatchId: string; bestOf: number; gameNumber: number }
  // Participants only, once a server is assigned
  connect?: { ip: string; port: number; password: string; connect: string }
}

type RoundRow = typeof matchRounds.$inferSelect

export function roundView(r: RoundRow): MatchRoundView {
  return {
    round: r.round,
    winnerTeam: r.winnerTeam,
    score: r.score,
    ...(r.arena ? { arena: r.arena } : {}),
    endedAt: r.endedAt.toISOString(),
  }
}

export function teamScores(teams: { name: string }[], score: Record<string, number> | null): { name: string; score: number }[] {
  return teams.map((t) => ({ name: t.name, score: score?.[t.name] ?? 0 }))
}

const SERVER_STATUSES = new Set(["starting", "ready", "live"])

export async function buildMatchPage(
  deps: { db: Db; users: UsersService; ratings: RatingService },
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
  const rounds = await db.select().from(matchRounds).where(eq(matchRounds.matchId, matchId)).orderBy(asc(matchRounds.round))
  const scores = teamScores(m.teams, m.score)

  const page: MatchPage = {
    id: m.id,
    mode: m.mode,
    mapId: m.mapId,
    status: m.status,
    driver: m.driver,
    startedAt: m.startedAt?.toISOString() ?? null,
    endedAt: m.endedAt?.toISOString() ?? null,
    teams: m.teams.map((t, idx) => ({
      name: t.name,
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
            kills: p.kills,
            deaths: p.deaths,
            headshots: p.headshots,
            damage: p.damage,
          }
        }),
    })),
    rounds: rounds.map(roundView),
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
  if (participant && SERVER_STATUSES.has(m.status) && m.serverIp && m.serverPort && m.connect) {
    page.connect = { ip: m.serverIp, port: m.serverPort, password: m.password ?? "", connect: m.connect }
  }
  return page
}
