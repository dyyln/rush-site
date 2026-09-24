import { findMap, type MapEntry, type MatchDetailPlayer, type MatchMap, type PlayerStats } from "@rushsite/shared"
import { and, asc, eq, isNull } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { demos, matchMaps, matches, type SeriesStatsJson } from "../../db/schema.js"
import type { SeriesParams } from "./allocator.js"
import type { DemoStorage } from "./storage.js"

// Presigned demo links on the match page live this long
const MAP_DEMO_TTL_SEC = 10 * 60

type MatchRow = typeof matches.$inferSelect
export type MapRow = typeof matchMaps.$inferSelect

// A map already decided before this match, carried over from an earlier match of the same series
export type PriorMap = { mapNumber: number; winnerTeam: string; matchId: string }

// A match is a series when it plays more than one map on its server
export function isSeries(m: Pick<MatchRow, "bestOf">): boolean {
  return (m.bestOf ?? 1) > 1
}

export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1
}

// One map per map number. A short veto list repeats its last map
export function padMaps(maps: string[], bestOf: number): string[] {
  if (maps.length === 0) return maps
  return Array.from({ length: bestOf }, (_, i) => maps[Math.min(i, maps.length - 1)]!)
}

// Maps won per team name, counting only decided maps
export function mapWins(teams: { name: string }[], rows: Pick<MapRow, "status" | "winnerTeam">[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(teams.map((t) => [t.name, 0]))
  for (const r of rows) {
    if (r.status === "done" && r.winnerTeam && r.winnerTeam in out) out[r.winnerTeam]! += 1
  }
  return out
}

// Team that reached the wins a series needs, or null while it runs
export function seriesWinner(bestOf: number, wins: Record<string, number>): string | null {
  const need = winsNeeded(bestOf)
  return Object.entries(wins).find(([, n]) => n >= need)?.[0] ?? null
}

// Stat totals over the maps played on this server
export function sumStats(rows: Pick<MapRow, "players" | "playedIn">[]): PlayerStats[] {
  const byId = new Map<string, PlayerStats>()
  for (const r of rows) {
    if (r.playedIn) continue
    for (const p of r.players ?? []) {
      const cur = byId.get(p.steamId) ?? { steamId: p.steamId, kills: 0, deaths: 0, headshots: 0, damage: 0 }
      byId.set(p.steamId, {
        steamId: p.steamId,
        kills: cur.kills + p.kills,
        deaths: cur.deaths + p.deaths,
        headshots: cur.headshots + p.headshots,
        damage: cur.damage + p.damage,
      })
    }
  }
  return [...byId.values()]
}

export async function loadMapRows(db: Db, matchId: string): Promise<MapRow[]> {
  return db.select().from(matchMaps).where(eq(matchMaps.matchId, matchId)).orderBy(asc(matchMaps.mapNumber))
}

// Rows for maps decided on an earlier match of the series. The new server starts after them
export async function seedPriorMaps(tx: Db, matchId: string, maps: string[], prior: PriorMap[]): Promise<void> {
  if (prior.length === 0) return
  await tx
    .insert(matchMaps)
    .values(
      prior.map((p) => ({
        matchId,
        mapNumber: p.mapNumber,
        mapId: maps[p.mapNumber - 1] ?? "",
        status: "done",
        winnerTeam: p.winnerTeam,
        playedIn: p.matchId,
      })),
    )
    .onConflictDoNothing()
}

// The series block of the start request. Null when a map id is no longer in the mode config
export function seriesParams(m: MatchRow, rows: MapRow[]): SeriesParams | null {
  const bestOf = m.bestOf ?? 1
  const ids = padMaps(m.maps ?? [], bestOf)
  if (ids.length !== bestOf) return null
  const maps: MapEntry[] = []
  for (const id of ids) {
    const map = findMap(m.mode, id)
    if (!map) return null
    maps.push(map)
  }
  return { bestOf, maps, startMapNumber: m.gameNumber ?? 1, wins: mapWins(m.teams, rows) }
}

// Every map of the series for the match page and match_update. Upcoming maps have zero scores
export function mapViews(m: MatchRow, rows: MapRow[]): MatchMap[] {
  const ids = padMaps(m.maps ?? [], m.bestOf ?? 1)
  const zero = Object.fromEntries(m.teams.map((t) => [t.name, 0]))
  return ids.map((mapId, i) => {
    const r = rows.find((x) => x.mapNumber === i + 1)
    return {
      mapNumber: i + 1,
      mapId: r?.mapId || mapId,
      status: r ? (r.status === "done" ? "done" : "live") : "upcoming",
      winnerTeam: r?.winnerTeam ?? null,
      score: r && Object.keys(r.score).length > 0 ? r.score : zero,
      ...(r?.playedIn ? { playedIn: r.playedIn } : {}),
    }
  })
}

export function toStatsJson(players: PlayerStats[]): SeriesStatsJson {
  return players.map((p) => ({ steamId: p.steamId, kills: p.kills, deaths: p.deaths, headshots: p.headshots, damage: p.damage }))
}

// Map list for the match page with per map stat lines and demo links.
// lines holds each player's card from the page, the stats are replaced with that map's
export async function seriesDetail(
  db: Db,
  m: MatchRow,
  lines: Map<string, MatchDetailPlayer>,
  storage: DemoStorage | undefined,
  now: number,
): Promise<MatchMap[]> {
  const rows = await loadMapRows(db, m.id)
  const demoRows = await db
    .select()
    .from(demos)
    .where(and(eq(demos.matchId, m.id), eq(demos.uploaded, true), isNull(demos.deletedAt)))
  const out: MatchMap[] = []
  for (const view of mapViews(m, rows)) {
    const row = rows.find((r) => r.mapNumber === view.mapNumber)
    const players = (row?.players ?? []).flatMap((p) => {
      const card = lines.get(p.steamId)
      return card ? [{ ...card, kills: p.kills, deaths: p.deaths, headshots: p.headshots, damage: p.damage }] : []
    })
    const demo = demoRows.find((d) => d.mapNumber === view.mapNumber)
    let demoView: MatchMap["demo"]
    if (view.status === "done" && !view.playedIn) {
      demoView =
        demo && storage?.enabled && storage.presignDownload
          ? {
              available: true,
              url: await storage.presignDownload(demo.key, MAP_DEMO_TTL_SEC),
              expiresAt: new Date(now + MAP_DEMO_TTL_SEC * 1000).toISOString(),
            }
          : { available: false }
    }
    out.push({ ...view, ...(demoView ? { demo: demoView } : {}), ...(players.length > 0 ? { players } : {}) })
  }
  return out
}
