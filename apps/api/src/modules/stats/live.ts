import type { LiveMatch } from "@rushsite/shared"
import { and, asc, desc, eq, inArray, max } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { matchPlayers, matches, ratings, tournaments, users } from "../../db/schema.js"

// Statuses shown in the watch live list
export const LIVE_STATUSES = ["ready", "live"] as const

// Matches in progress, highest rated first
export async function liveMatches(db: Db, limit: number): Promise<LiveMatch[]> {
  const top = max(ratings.rating)
  const rows = await db
    .select({ m: matches, topRating: top })
    .from(matches)
    .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .leftJoin(ratings, and(eq(ratings.steamId, matchPlayers.steamId), eq(ratings.mode, matches.mode)))
    .where(inArray(matches.status, [...LIVE_STATUSES]))
    .groupBy(matches.id)
    .orderBy(desc(top), desc(matches.startedAt))
    .limit(limit)
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.m.id)
  const players = await db
    .select({
      matchId: matchPlayers.matchId,
      team: matchPlayers.team,
      steamId: matchPlayers.steamId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(matchPlayers)
    .innerJoin(users, eq(users.steamId, matchPlayers.steamId))
    .where(inArray(matchPlayers.matchId, ids))
    .orderBy(asc(matchPlayers.steamId))
  const cupIds = [...new Set(rows.map((r) => r.m.tournamentId).filter((id): id is string => !!id))]
  const cups = cupIds.length
    ? await db.select({ id: tournaments.id, name: tournaments.name }).from(tournaments).where(inArray(tournaments.id, cupIds))
    : []

  return rows.map(({ m, topRating }) => {
    const cup = cups.find((c) => c.id === m.tournamentId)
    return {
      id: m.id,
      mode: m.mode,
      mapId: m.mapId,
      status: m.status,
      startedAt: m.startedAt ? m.startedAt.toISOString() : null,
      teams: m.teams.map((t, i) => ({
        name: t.name,
        score: m.score?.[t.name] ?? 0,
        players: players
          .filter((p) => p.matchId === m.id && p.team === i)
          .map((p) => ({ steamId: p.steamId, displayName: p.displayName, avatarUrl: p.avatarUrl })),
      })),
      ...(cup ? { tournament: cup } : {}),
      topRating: topRating === null ? null : Math.round(Number(topRating)),
    }
  })
}
