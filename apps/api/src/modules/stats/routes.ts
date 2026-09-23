import {
  LEADERBOARD_MIN_MATCHES,
  MODES,
  computeStreak,
  ModeSchema,
  getModeConfig,
  tierForRating,
  type Mode,
  type ModeStatsPayload,
} from "@rushsite/shared"
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badges, bans, matchKills, matchPlayers, matches, ratingEvents, ratings, tournaments, users } from "../../db/schema.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { globalRank, namePattern } from "./rank.js"

const SteamIdParam = z.string().regex(/^\d{17}$/)
const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().trim().max(32).optional(),
})

// Statuses that count as a game in progress for the live mode stats
export const IN_PROGRESS_STATUSES = ["starting", "ready", "live"] as const
const HISTORY_POINTS = 200
const RECENT_MATCHES = 20

export const notBanned = sql`not exists (select 1 from ${bans} where ${bans.steamId} = ${ratings.steamId} and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now()))`

export async function modeStats(ctx: AppContext): Promise<ModeStatsPayload> {
  const rows = await ctx.db
    .select({ mode: matches.mode, n: sql<number>`count(*)::int` })
    .from(matches)
    .where(inArray(matches.status, [...IN_PROGRESS_STATUSES]))
    .groupBy(matches.mode)
  const modes = []
  for (const mode of MODES) {
    modes.push({
      mode,
      playersInQueue: await ctx.queue.playersInQueue(mode),
      matchesInProgress: rows.find((r) => r.mode === mode)?.n ?? 0,
    })
  }
  return { modes }
}

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/modes", async () =>
    MODES.map((mode) => {
      const cfg = getModeConfig(mode)
      return { mode, teamSize: cfg.teamSize, vetoFormat: cfg.vetoFormat, winCondition: cfg.winCondition, maps: cfg.maps }
    }),
  )

  app.get("/stats/modes", async () => modeStats(ctx))

  // Global per mode. Players need the minimum match count to place
  app.get("/leaderboard/:mode", async (req) => {
    const mode = ModeSchema.safeParse((req.params as { mode: string }).mode)
    if (!mode.success) throw notFound("unknown_mode")
    const page = Page.safeParse(req.query)
    if (!page.success) throw badRequest("invalid_query", "bad offset or limit", page.error.issues)
    const { limit, offset } = page.data
    // Name search keeps each row's global rank
    const q = page.data.q || undefined
    const where = and(
      eq(ratings.mode, mode.data),
      gte(ratings.matchesPlayed, LEADERBOARD_MIN_MATCHES),
      notBanned,
      ...(q ? [sql`lower(${users.displayName}) like ${namePattern(q)}`] : []),
    )
    const rows = await ctx.db
      .select({
        steamId: ratings.steamId,
        rating: ratings.rating,
        matches: ratings.matchesPlayed,
        wins: ratings.wins,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        ...(q ? { rank: globalRank } : {}),
      })
      .from(ratings)
      .innerJoin(users, eq(users.steamId, ratings.steamId))
      .where(where)
      .orderBy(desc(ratings.rating), asc(ratings.steamId))
      .limit(limit)
      .offset(offset)
    const totalQuery = ctx.db.select({ n: sql<number>`count(*)::int` }).from(ratings)
    const [total] = await (q ? totalQuery.innerJoin(users, eq(users.steamId, ratings.steamId)) : totalQuery).where(where)
    return {
      mode: mode.data,
      total: total?.n ?? 0,
      rows: rows.map((r, i) => ({
        rank: "rank" in r && typeof r.rank === "number" ? r.rank : offset + i + 1,
        steamId: r.steamId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        rating: Math.round(r.rating),
        tier: tierForRating(r.rating).id,
        matches: r.matches,
        wins: r.wins,
      })),
    }
  })

  app.get("/users/:steamId/profile", async (req) => {
    const id = SteamIdParam.safeParse((req.params as { steamId: string }).steamId)
    if (!id.success) throw notFound("user_not_found")
    const steamId = id.data
    const [user] = await ctx.db.select().from(users).where(eq(users.steamId, steamId))
    if (!user) throw notFound("user_not_found")
    const trust = (await ctx.trust.levels([steamId]))[steamId]!
    const banned = (await ctx.trust.activeBans([steamId])).has(steamId)
    const ratingRows = await ctx.db.select().from(ratings).where(eq(ratings.steamId, steamId))
    const shots = await ctx.db
      .select({
        mode: matches.mode,
        kills: sql<number>`coalesce(sum(${matchPlayers.kills}), 0)::int`,
        deaths: sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)::int`,
        headshots: sql<number>`coalesce(sum(${matchPlayers.headshots}), 0)::int`,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), eq(matches.status, "finished")))
      .groupBy(matches.mode)
    const mapRows = await ctx.db
      .select({
        mode: matches.mode,
        mapId: matches.mapId,
        played: sql<number>`count(*)::int`,
        wins: sql<number>`(count(*) filter (where ${matchPlayers.won}))::int`,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), inArray(matches.status, ["finished", "abandoned"])))
      .groupBy(matches.mode, matches.mapId)
    const results = await ctx.db
      .select({ mode: matches.mode, won: matchPlayers.won, abandoned: matchPlayers.abandoned })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), inArray(matches.status, ["finished", "abandoned"])))
      .orderBy(asc(sql`coalesce(${matches.endedAt}, ${matches.createdAt})`), asc(matches.createdAt))
    // Team kills do not count toward the favourite weapon
    const [weapon] = await ctx.db
      .select({ weapon: matchKills.weapon, kills: sql<number>`count(*)::int` })
      .from(matchKills)
      .where(and(eq(matchKills.attackerSteamId, steamId), sql`not exists (select 1 from ${matchPlayers} a join ${matchPlayers} v on v.match_id = a.match_id and v.team = a.team where a.match_id = ${matchKills.matchId} and a.steam_id = ${matchKills.attackerSteamId} and v.steam_id = ${matchKills.victimSteamId})`))
      .groupBy(matchKills.weapon)
      .orderBy(desc(sql`count(*)`), asc(matchKills.weapon))
      .limit(1)
    const history = await ctx.db
      .select({ mode: ratingEvents.mode, ts: ratingEvents.createdAt, rating: ratingEvents.ratingAfter })
      .from(ratingEvents)
      .where(and(eq(ratingEvents.steamId, steamId), isNull(ratingEvents.voidedAt)))
      .orderBy(asc(ratingEvents.seq))

    const modes = await Promise.all(
      MODES.map(async (mode) => {
        const r = ratingRows.find((x) => x.mode === mode)
        const s = shots.find((x) => x.mode === mode)
        const rating = r?.rating ?? 1500
        let leaderboardRank: number | null = null
        if (r && r.matchesPlayed >= LEADERBOARD_MIN_MATCHES && !banned) {
          const [above] = await ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(ratings)
            .where(
              and(
                eq(ratings.mode, mode),
                gte(ratings.matchesPlayed, LEADERBOARD_MIN_MATCHES),
                sql`${ratings.rating} > ${r.rating}`,
                notBanned,
              ),
            )
          leaderboardRank = (above?.n ?? 0) + 1
        }
        return {
          mode,
          rating: Math.round(rating),
          rd: Math.round(r?.rd ?? 350),
          tier: tierForRating(rating).id,
          matches: r?.matchesPlayed ?? 0,
          wins: r?.wins ?? 0,
          losses: r?.losses ?? 0,
          headshotPct: s && s.kills > 0 ? s.headshots / s.kills : 0,
          kd: s ? (s.deaths > 0 ? s.kills / s.deaths : s.kills) : 0,
          history: history
            .filter((h) => h.mode === mode)
            .slice(-HISTORY_POINTS)
            .map((h) => ({ ts: h.ts.getTime(), rating: Math.round(h.rating) })),
          bestMaps: mapRows
            .filter((m) => m.mode === mode && m.mapId)
            .map((m) => ({ mapId: m.mapId!, matches: m.played, wins: m.wins }))
            .sort((a, b) => b.wins / b.matches - a.wins / a.matches || b.matches - a.matches)
            .slice(0, 5),
          leaderboardRank,
          streak: computeStreak(
            results
              .filter((x) => x.mode === mode)
              .map((x) => (x.abandoned ? "abandoned" : x.won ? "win" : "loss")),
          ),
        }
      }),
    )

    const badgeRows = await ctx.db
      .select({ b: badges, tournamentName: tournaments.name, tournamentMode: tournaments.mode })
      .from(badges)
      .leftJoin(tournaments, eq(tournaments.id, badges.tournamentId))
      .where(eq(badges.steamId, steamId))
      .orderBy(desc(badges.awardedAt))

    return {
      user: {
        steamId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        trustLevel: trust,
        region: user.region,
      },
      // Full progress only for the player looking at their own profile
      trust: (await ctx.auth(req)) === steamId ? await ctx.trust.progress(steamId) : { level: trust },
      modes,
      badges: badgeRows.map(({ b, tournamentName, tournamentMode }) => ({
        id: b.id,
        kind: b.kind,
        tournamentId: b.tournamentId,
        tournamentName: tournamentName ?? b.label,
        mode: b.mode ?? tournamentMode,
        awardedAt: b.awardedAt.toISOString(),
      })),
      recentMatches: await recentMatches(ctx, steamId, RECENT_MATCHES),
      favouriteWeapon: weapon ? { weapon: weapon.weapon, kills: weapon.kills } : null,
    }
  })

  app.get("/users/:steamId/matches", async (req) => {
    const id = SteamIdParam.safeParse((req.params as { steamId: string }).steamId)
    if (!id.success) throw notFound("user_not_found")
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.number().int().positive().optional() })
      .safeParse(req.query)
    if (!q.success) throw badRequest("invalid_query", "bad limit or before", q.error.issues)
    return { matches: await recentMatches(ctx, id.data, q.data.limit, q.data.before) }
  })
}

async function recentMatches(ctx: AppContext, steamId: string, limit: number, before?: number) {
  const rows = await ctx.db
    .select({ m: matches, p: matchPlayers })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(
      and(
        eq(matchPlayers.steamId, steamId),
        inArray(matches.status, ["finished", "abandoned"]),
        ...(before ? [sql`${matches.createdAt} < ${new Date(before)}`] : []),
      ),
    )
    .orderBy(desc(matches.createdAt))
    .limit(limit)
  const ids = rows.map((r) => r.m.id)
  const deltas = ids.length
    ? await ctx.db
        .select({ matchId: ratingEvents.matchId, before: ratingEvents.ratingBefore, after: ratingEvents.ratingAfter })
        .from(ratingEvents)
        .where(and(eq(ratingEvents.steamId, steamId), inArray(ratingEvents.matchId, ids), isNull(ratingEvents.voidedAt)))
    : []
  return rows.map(({ m, p }) => {
    const mine = m.teams[p.team]?.name ?? ""
    const theirs = m.teams[p.team === 0 ? 1 : 0]?.name ?? ""
    const d = deltas.find((x) => x.matchId === m.id)
    const result: "win" | "loss" | "abandoned" = p.abandoned ? "abandoned" : p.won ? "win" : "loss"
    return {
      matchId: m.id,
      mode: m.mode as Mode,
      mapId: m.mapId ?? "",
      playedAt: m.createdAt.toISOString(),
      result,
      scoreFor: m.score?.[mine] ?? 0,
      scoreAgainst: m.score?.[theirs] ?? 0,
      ratingDelta: d ? Math.round(d.after - d.before) : 0,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      headshots: p.headshots ?? 0,
    }
  })
}
