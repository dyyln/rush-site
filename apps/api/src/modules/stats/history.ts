import type { Mode } from "@rushsite/shared"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { matchPlayers, matches, ratingEvents } from "../../db/schema.js"
import { badRequest } from "../../lib/errors.js"

export const HISTORY_STATUSES = ["finished", "abandoned"] as const

export type HistoryRow = {
  matchId: string
  // Word id for links. Null on matches from before word ids
  slug: string | null
  mode: Mode
  mapId: string
  // Set on a best of series. Scores are then maps won
  bestOf: number | null
  maps: string[] | null
  playedAt: string
  result: "win" | "loss" | "abandoned"
  scoreFor: number
  scoreAgainst: number
  ratingDelta: number
  kills: number
  deaths: number
  headshots: number
}

export type HistoryPage = { matches: HistoryRow[]; nextCursor: string | null }

// Postgres text keeps microseconds so rows that share a millisecond are not skipped
const CursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/),
  id: z.uuid(),
})
type Cursor = z.infer<typeof CursorSchema>

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url")
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")))
    if (parsed.success) return parsed.data
  } catch {
    // Falls through to the error below
  }
  throw badRequest("invalid_cursor", "bad cursor")
}

// Newest first. Ties on created_at break on id so paging is stable
export async function matchHistory(
  ctx: AppContext,
  steamId: string,
  opts: { limit: number; cursor?: string; mode?: Mode },
): Promise<HistoryPage> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null
  const rows = await ctx.db
    .select({ m: matches, p: matchPlayers, at: sql<string>`${matches.createdAt}::text` })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(
      and(
        eq(matchPlayers.steamId, steamId),
        inArray(matches.status, [...HISTORY_STATUSES]),
        ...(opts.mode ? [eq(matches.mode, opts.mode)] : []),
        ...(cursor ? [sql`(${matches.createdAt}, ${matches.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`] : []),
      ),
    )
    .orderBy(desc(matches.createdAt), desc(matches.id))
    .limit(opts.limit + 1)
  const page = rows.slice(0, opts.limit)
  const last = page.at(-1)
  const nextCursor = rows.length > opts.limit && last ? encodeCursor({ t: last.at, id: last.m.id }) : null

  const ids = page.map((r) => r.m.id)
  const deltas = ids.length
    ? await ctx.db
        .select({ matchId: ratingEvents.matchId, before: ratingEvents.ratingBefore, after: ratingEvents.ratingAfter })
        .from(ratingEvents)
        .where(and(eq(ratingEvents.steamId, steamId), inArray(ratingEvents.matchId, ids), isNull(ratingEvents.voidedAt)))
    : []
  const matchesOut = page.map(({ m, p }): HistoryRow => {
    const mine = m.teams[p.team]?.name ?? ""
    const theirs = m.teams[p.team === 0 ? 1 : 0]?.name ?? ""
    const d = deltas.find((x) => x.matchId === m.id)
    const series = (m.bestOf ?? 1) > 1
    const scoreFor = m.score?.[mine] ?? 0
    const scoreAgainst = m.score?.[theirs] ?? 0
    // A series score counts maps won, so the maps played are the first that many
    const played = Math.max(1, scoreFor + scoreAgainst)
    return {
      matchId: m.id,
      slug: m.slug,
      mode: m.mode as Mode,
      mapId: m.mapId ?? "",
      bestOf: series ? m.bestOf : null,
      maps: series && m.maps ? m.maps.slice(0, played) : null,
      playedAt: m.createdAt.toISOString(),
      result: p.abandoned ? "abandoned" : p.won ? "win" : "loss",
      scoreFor,
      scoreAgainst,
      ratingDelta: d ? Math.round(d.after - d.before) : 0,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      headshots: p.headshots ?? 0,
    }
  })
  return { matches: matchesOut, nextCursor }
}
