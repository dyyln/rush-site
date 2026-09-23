import { LEADERBOARD_MIN_MATCHES, tierForRating, type Mode, type TierId } from "@rushsite/shared"
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"
import type { AppContext } from "../../context.js"
import { ratings, users } from "../../db/schema.js"
import { notBanned } from "./routes.js"

const FRIENDS_TTL_SEC = 300

export type FriendsLeaderboard = {
  mode: Mode
  total: number
  rows: {
    // Position among placed friends. null while unplaced
    rank: number | null
    placed: boolean
    steamId: string
    displayName: string
    avatarUrl: string | null
    rating: number
    tier: TierId
    matches: number
    wins: number
  }[]
  // False when the Steam friend list could not be read. Rows then hold only you
  friendsAvailable: boolean
  reason?: "steam_api_disabled" | "friends_private"
}

// Steam friend ids cached in Redis for a few minutes
export async function friendIds(ctx: AppContext, steamId: string): Promise<{ ids: string[]; reason?: FriendsLeaderboard["reason"] }> {
  if (!ctx.steam.enabled) return { ids: [], reason: "steam_api_disabled" }
  const key = `stats:friends:${steamId}`
  const cached = await ctx.redis.get(key)
  if (cached !== null) {
    const parsed = JSON.parse(cached) as string[] | null
    return parsed ? { ids: parsed } : { ids: [], reason: "friends_private" }
  }
  const list = await ctx.steam.friendList(steamId)
  const ids = list ? list.map((f) => f.steamid) : null
  await ctx.redis.set(key, JSON.stringify(ids), "EX", FRIENDS_TTL_SEC)
  return ids ? { ids } : { ids: [], reason: "friends_private" }
}

// Every friend with a match in the mode. Placed friends come first and carry a rank
export async function friendsLeaderboard(ctx: AppContext, mode: Mode, steamId: string): Promise<FriendsLeaderboard> {
  const friends = await friendIds(ctx, steamId)
  const ids = [...new Set([steamId, ...friends.ids])]
  const rows = await ctx.db
    .select({
      steamId: ratings.steamId,
      rating: ratings.rating,
      matches: ratings.matchesPlayed,
      wins: ratings.wins,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(ratings)
    .innerJoin(users, eq(users.steamId, ratings.steamId))
    .where(and(eq(ratings.mode, mode), inArray(ratings.steamId, ids), gte(ratings.matchesPlayed, 1), notBanned))
    .orderBy(desc(ratings.rating), asc(ratings.steamId))
  const placed = (m: number) => m >= LEADERBOARD_MIN_MATCHES
  const sorted = [...rows].sort((a, b) => Number(placed(b.matches)) - Number(placed(a.matches)))
  let rank = 0
  return {
    mode,
    total: sorted.length,
    rows: sorted.map((r) => ({
      rank: placed(r.matches) ? ++rank : null,
      placed: placed(r.matches),
      steamId: r.steamId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      rating: Math.round(r.rating),
      tier: tierForRating(r.rating).id,
      matches: r.matches,
      wins: r.wins,
    })),
    friendsAvailable: !friends.reason,
    ...(friends.reason ? { reason: friends.reason } : {}),
  }
}
