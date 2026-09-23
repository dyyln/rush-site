import { LEADERBOARD_MIN_MATCHES, TIERS, tierForRating, type Mode, type TierDistribution, type TierId } from "@rushsite/shared"
import { and, eq, gte, sql } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { ratings } from "../../db/schema.js"
import { notBanned } from "./routes.js"

export type YouInput = { rating: number; below: number; placed: boolean }

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildDistribution(mode: Mode, counts: Partial<Record<TierId, number>>, you?: YouInput): TierDistribution {
  const total = TIERS.reduce((s, t) => s + (counts[t.id] ?? 0), 0)
  const out: TierDistribution = {
    mode,
    total,
    tiers: TIERS.map((t) => {
      const count = counts[t.id] ?? 0
      return { tier: t.id, count, pct: total > 0 ? count / total : 0 }
    }),
  }
  if (you) {
    out.you = {
      tier: tierForRating(you.rating).id,
      rating: Math.round(you.rating),
      percentile: total > 0 ? Math.min(100, round1((you.below / total) * 100)) : 0,
      placed: you.placed,
    }
  }
  return out
}

// SQL expression that buckets a rating into a tier id with the same rounding as tierForRating.
// Bands are inlined so select and group by see the same expression
function tierCase() {
  const parts = TIERS.map((t) => {
    const lo = t.min === null ? sql`true` : sql`round(${ratings.rating}) >= ${sql.raw(String(Number(t.min)))}`
    const hi = t.max === null ? sql`true` : sql`round(${ratings.rating}) < ${sql.raw(String(Number(t.max)))}`
    return sql`when ${lo} and ${hi} then ${sql.raw(`'${t.id.replace(/[^a-z]/g, "")}'`)}`
  })
  return sql<string>`case ${sql.join(parts, sql` `)} end`
}

export async function tierDistribution(db: Db, mode: Mode, steamId: string | null): Promise<TierDistribution> {
  const placed = and(eq(ratings.mode, mode), gte(ratings.matchesPlayed, LEADERBOARD_MIN_MATCHES), notBanned)
  const bucket = tierCase()
  const rows = await db
    .select({ tier: bucket, n: sql<number>`count(*)::int` })
    .from(ratings)
    .where(placed)
    .groupBy(bucket)
  const counts: Partial<Record<TierId, number>> = {}
  for (const r of rows) counts[r.tier as TierId] = r.n

  let you: YouInput | undefined
  if (steamId) {
    const [mine] = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.steamId, steamId), eq(ratings.mode, mode)))
    if (mine && mine.matchesPlayed > 0) {
      const [below] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(ratings)
        .where(and(placed, sql`${ratings.rating} < ${mine.rating}`))
      you = { rating: mine.rating, below: below?.n ?? 0, placed: mine.matchesPlayed >= LEADERBOARD_MIN_MATCHES }
    }
  }
  return buildDistribution(mode, counts, you)
}
