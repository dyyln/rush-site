import {
  LEADERBOARD_MIN_MATCHES,
  isTestMode,
  MODES,
  RANKED_MODES,
  computeStreak,
  ModeSchema,
  getModeConfig,
  tierForRating,
  type ModeStatsPayload,
} from "@rushsite/shared"
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badges, bans, matchKills, matchPlayers, matches, ratingEvents, ratings, tournaments, users } from "../../db/schema.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { matchHistory } from "./history.js"
import { ExternalRanksService } from "./external-ranks.js"
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

const TOTALS_KEY = "stats:totals"

// Registered players and matches played to the end
export type SiteTotals = { players: number; matches: number }

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
  app.get("/modes", async () => {
    await ctx.maps.ensureFresh()
    return MODES.map((mode) => {
      const cfg = getModeConfig(mode)
      return {
        mode,
        teamSize: cfg.teamSize,
        vetoFormat: cfg.vetoFormat,
        winCondition: cfg.winCondition,
        maps: ctx.maps.entries(mode),
        ...(cfg.test ? { test: true } : {}),
      }
    })
  })

  // Names and previews for every known map, enabled or not
  app.get("/maps", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60")
    return { maps: await ctx.maps.publicMaps() }
  })

  app.get("/stats/modes", async () => modeStats(ctx))

  // Site wide counts for the home and play pages. Cached briefly since every guest asks
  app.get("/stats/totals", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60")
    const hit = await ctx.redis.get(TOTALS_KEY)
    if (hit) return JSON.parse(hit) as SiteTotals
    const [p] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users)
    const [m] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.status, "finished"))
    const totals: SiteTotals = { players: p?.n ?? 0, matches: m?.n ?? 0 }
    await ctx.redis.set(TOTALS_KEY, JSON.stringify(totals), "EX", 60)
    return totals
  })

  // Global per mode. Players need the minimum match count to place
  app.get("/leaderboard/:mode", async (req) => {
    const mode = ModeSchema.safeParse((req.params as { mode: string }).mode)
    if (!mode.success || isTestMode(mode.data)) throw notFound("unknown_mode")
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

  // FACEIT, Premier and Wingman ranks. Separate from the profile so a slow Leetify never holds it up
  const external = new ExternalRanksService(ctx.db, ctx.redis, ctx.fetch, ctx.log, ctx.env.LEETIFY_API_KEY, ctx.faceit)
  app.get("/users/:steamId/ranks", async (req, reply) => {
    const id = SteamIdParam.safeParse((req.params as { steamId: string }).steamId)
    if (!id.success) throw notFound("user_not_found")
    const [user] = await ctx.db.select({ steamId: users.steamId }).from(users).where(eq(users.steamId, id.data))
    if (!user) throw notFound("user_not_found")
    reply.header("cache-control", "public, max-age=600")
    return external.get(id.data)
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
      RANKED_MODES.map(async (mode) => {
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

    const firstPage = await matchHistory(ctx, steamId, { limit: RECENT_MATCHES })

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
      recentMatches: firstPage.matches,
      // Pass to /users/:steamId/matches for the next page
      recentMatchesCursor: firstPage.nextCursor,
      favouriteWeapon: weapon ? { weapon: weapon.weapon, kills: weapon.kills } : null,
      backgroundUrl: await profileBackground(ctx, steamId),
    }
  })

  app.get("/users/:steamId/matches", async (req) => {
    const id = SteamIdParam.safeParse((req.params as { steamId: string }).steamId)
    if (!id.success) throw notFound("user_not_found")
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(200).optional(),
        mode: ModeSchema.optional(),
      })
      .safeParse(req.query)
    if (!q.success) throw badRequest("invalid_query", "bad limit, cursor or mode", q.error.issues)
    return matchHistory(ctx, id.data, q.data)
  })
}

const BACKGROUND_TTL_SEC = 6 * 3600

// The player's Steam profile background for the profile hero, cached so a busy profile
// doesn't ask Steam on every view. Steam failing only loses the art
async function profileBackground(ctx: AppContext, steamId: string): Promise<string | null> {
  const key = `steam:bg:${steamId}`
  try {
    const cached = await ctx.redis.get(key)
    if (cached !== null) return cached || null
    const url = await ctx.steam.profileBackground(steamId)
    await ctx.redis.set(key, url ?? "", "EX", BACKGROUND_TTL_SEC)
    return url
  } catch {
    return null
  }
}
