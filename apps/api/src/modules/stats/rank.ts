import { LEADERBOARD_MIN_MATCHES, type Mode } from "@rushsite/shared"
import { and, eq, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { AppContext } from "../../context.js"
import { bans, ratings, users } from "../../db/schema.js"

// Queries shorter than this match on the name prefix only, which the lower(display_name) index serves
export const CONTAINS_MIN_LEN = 3

const above = alias(ratings, "above")

// Global rank of the current ratings row, same order as the leaderboard (rating desc, steamId asc)
// Use it only in a query with a join so ratings columns are rendered qualified
export const globalRank: SQL<number> = sql<number>`(select count(*)::int + 1 from ${ratings} as ${above} where ${above.mode} = ${ratings.mode} and ${above.matchesPlayed} >= ${LEADERBOARD_MIN_MATCHES} and (${above.rating} > ${ratings.rating} or (${above.rating} = ${ratings.rating} and ${above.steamId} < ${ratings.steamId})) and not exists (select 1 from ${bans} where ${bans.steamId} = ${above.steamId} and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now())))`

// Escapes LIKE wildcards so a name with % or _ is matched literally
export function namePattern(q: string): string {
  const lower = q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)
  return q.length < CONTAINS_MIN_LEN ? `${lower}%` : `%${lower}%`
}

export type MyRank = {
  mode: Mode
  placed: boolean
  // Global rank and the offset of the page that holds it. null while unplaced or banned
  rank: number | null
  offset: number | null
  limit: number
  matches: number
  needed: number
}

export async function myRank(ctx: AppContext, mode: Mode, steamId: string, limit: number): Promise<MyRank> {
  const [row] = await ctx.db
    .select({
      matches: ratings.matchesPlayed,
      rank: globalRank,
      banned: sql<boolean>`exists (select 1 from ${bans} where ${bans.steamId} = ${ratings.steamId} and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now()))`,
    })
    .from(ratings)
    // The join makes drizzle qualify column names, which the correlated subqueries need
    .innerJoin(users, eq(users.steamId, ratings.steamId))
    .where(and(eq(ratings.mode, mode), eq(ratings.steamId, steamId)))
  const matches = row?.matches ?? 0
  const placed = !!row && matches >= LEADERBOARD_MIN_MATCHES && !row.banned
  const rank = placed ? row.rank : null
  return {
    mode,
    placed,
    rank,
    offset: rank === null ? null : Math.floor((rank - 1) / limit) * limit,
    limit,
    matches,
    needed: Math.max(0, LEADERBOARD_MIN_MATCHES - matches),
  }
}
