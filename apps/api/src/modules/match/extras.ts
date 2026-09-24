import type { Kill, MatchDemo, MatchEvent, MatchExtras, MatchMvp } from "@rushsite/shared"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { demos, matchKills, matchPlayers, ratingEvents, reports } from "../../db/schema.js"
import type { MatchPage } from "./match-page.js"
import type { DemoStorage } from "./storage.js"

export type KillEvent = Extract<MatchEvent, { type: "kill" }>

export const DEMO_URL_TTL_SEC = 10 * 60

const OVER = new Set(["finished", "abandoned", "cancelled"])

// Kills between two match players are stored. Replays of the same kill are ignored
export async function storeKill(db: Db, matchId: string, event: KillEvent): Promise<boolean> {
  const ids = [event.attacker, event.victim, ...(event.assister ? [event.assister] : [])]
  const rows = await db
    .select({ steamId: matchPlayers.steamId })
    .from(matchPlayers)
    .where(and(eq(matchPlayers.matchId, matchId), inArray(matchPlayers.steamId, ids)))
  const known = new Set(rows.map((r) => r.steamId))
  if (!known.has(event.attacker) || !known.has(event.victim)) return false
  const inserted = await db
    .insert(matchKills)
    .values({
      matchId,
      mapNumber: event.mapNumber ?? 1,
      round: event.round,
      tick: event.tick,
      attackerSteamId: event.attacker,
      victimSteamId: event.victim,
      assisterSteamId: event.assister && known.has(event.assister) ? event.assister : null,
      weapon: event.weapon,
      headshot: event.headshot,
      wallbang: event.wallbang,
    })
    .onConflictDoNothing()
    .returning({ round: matchKills.round })
  return inserted.length > 0
}

type KillRow = typeof matchKills.$inferSelect

export function killView(r: KillRow, series = false): Kill {
  return {
    ...(series ? { mapNumber: r.mapNumber } : {}),
    round: r.round,
    tick: r.tick,
    attacker: r.attackerSteamId,
    victim: r.victimSteamId,
    ...(r.assisterSteamId ? { assister: r.assisterSteamId } : {}),
    weapon: r.weapon,
    headshot: r.headshot,
    wallbang: r.wallbang,
  }
}

// A running match shows kills only for rounds that have ended, so the current round stays hidden.
// In a series lastEnded is the last ended map and round, earlier maps show in full
export async function loadKills(
  db: Db,
  matchId: string,
  status: string,
  lastEnded: { mapNumber: number; round: number },
  series = false,
): Promise<Kill[]> {
  const rows = await db
    .select()
    .from(matchKills)
    .where(eq(matchKills.matchId, matchId))
    .orderBy(asc(matchKills.mapNumber), asc(matchKills.round), asc(matchKills.tick), asc(matchKills.victimSteamId))
  const ended = (r: KillRow) =>
    r.mapNumber < lastEnded.mapNumber || (r.mapNumber === lastEnded.mapNumber && r.round <= lastEnded.round)
  const visible = OVER.has(status) ? rows : rows.filter(ended)
  return visible.map((r) => killView(r, series))
}

export type LiveLine = { kills: number; deaths: number; headshots: number }

// Stat lines counted from kill events, per map number, for maps the plugin has not sent final stats for.
// Same rules as the plugin: a team kill gives no kill, headshots only count on enemy kills, every death counts.
// A running match only counts ended rounds, like the kill feed. Suicides and deaths to the world send no
// kill event, so they are missing until the plugin's totals replace these lines. Damage is not in kill events
export async function loadLiveStats(
  db: Db,
  matchId: string,
  status: string,
  lastEnded: { mapNumber: number; round: number },
  doneMaps: ReadonlySet<number>,
  teamOf: ReadonlyMap<string, number>,
): Promise<Map<number, Map<string, LiveLine>>> {
  const rows = await db.select().from(matchKills).where(eq(matchKills.matchId, matchId))
  const ended = (r: KillRow) =>
    r.mapNumber < lastEnded.mapNumber || (r.mapNumber === lastEnded.mapNumber && r.round <= lastEnded.round)
  const out = new Map<number, Map<string, LiveLine>>()
  const line = (map: number, id: string) => {
    const lines = out.get(map) ?? out.set(map, new Map()).get(map)!
    return lines.get(id) ?? lines.set(id, { kills: 0, deaths: 0, headshots: 0 }).get(id)!
  }
  for (const r of rows) {
    if (doneMaps.has(r.mapNumber) || (!OVER.has(status) && !ended(r))) continue
    line(r.mapNumber, r.victimSteamId).deaths++
    const team = teamOf.get(r.attackerSteamId)
    if (team === undefined || team === teamOf.get(r.victimSteamId)) continue
    const a = line(r.mapNumber, r.attackerSteamId)
    a.kills++
    if (r.headshot) a.headshots++
  }
  return out
}

type MvpLine = { steamId: string; kills: number; deaths: number; damage: number }

// Highest damage wins. Kills break a damage tie, then fewer deaths, then the lower id so the pick is stable
export function computeMvp(players: MvpLine[]): MatchMvp | null {
  const eligible = players.filter((p) => p.damage > 0 || p.kills > 0)
  if (eligible.length === 0) return null
  const sorted = [...eligible].sort(
    (a, b) => b.damage - a.damage || b.kills - a.kills || a.deaths - b.deaths || a.steamId.localeCompare(b.steamId),
  )
  const top = sorted[0]!
  const runnerUp = sorted[1]
  const damageTied = !!runnerUp && runnerUp.damage === top.damage && runnerUp.kills < top.kills
  return { steamId: top.steamId, reason: damageTied ? "most_kills" : "most_damage" }
}

// A download link is only handed out once the plugin reported a good upload
export async function demoView(db: Db, storage: DemoStorage, matchId: string, now: number): Promise<MatchDemo> {
  const [row] = await db
    .select()
    .from(demos)
    .where(and(eq(demos.matchId, matchId), eq(demos.uploaded, true), isNull(demos.deletedAt)))
    .orderBy(asc(demos.mapNumber))
    .limit(1)
  if (!row || !storage.enabled || !storage.presignDownload) return { available: false }
  const url = await storage.presignDownload(row.key, DEMO_URL_TTL_SEC)
  return { available: true, url, expiresAt: new Date(now + DEMO_URL_TTL_SEC * 1000).toISOString() }
}

// Rollbacks and admin adjustments are left out so the delta is what the match itself did
export async function loadRatingDeltas(db: Db, matchId: string, status: string): Promise<Record<string, number>> {
  if (status !== "finished") return {}
  const rows = await db
    .select({ steamId: ratingEvents.steamId, before: ratingEvents.ratingBefore, after: ratingEvents.ratingAfter })
    .from(ratingEvents)
    .where(
      and(eq(ratingEvents.matchId, matchId), inArray(ratingEvents.reason, ["match", "forfeit"]), isNull(ratingEvents.voidedAt)),
    )
  const sums = new Map<string, number>()
  for (const r of rows) sums.set(r.steamId, (sums.get(r.steamId) ?? 0) + (r.after - r.before))
  return Object.fromEntries([...sums].map(([id, d]) => [id, Math.round(d)]))
}

export async function loadViewerReported(db: Db, matchId: string, viewer: string | null): Promise<string[]> {
  if (!viewer) return []
  const rows = await db
    .select({ steamId: reports.reportedSteamId })
    .from(reports)
    .where(and(eq(reports.matchId, matchId), eq(reports.reporterSteamId, viewer)))
  return rows.map((r) => r.steamId).sort()
}

export async function buildMatchExtras(
  deps: { db: Db; storage: DemoStorage; now: () => number },
  page: MatchPage,
  viewer: string | null = null,
): Promise<MatchExtras> {
  // Rounds come ordered by map then round, so the last one is the latest ended
  const last = page.rounds.at(-1)
  const lastEnded = { mapNumber: last?.mapNumber ?? 1, round: last?.round ?? 0 }
  const players = page.teams.flatMap((t) => t.players)
  const [kills, demo, ratingDeltas, viewerReported] = await Promise.all([
    loadKills(deps.db, page.id, page.status, lastEnded, (page.bestOf ?? 1) > 1),
    demoView(deps.db, deps.storage, page.id, deps.now()),
    loadRatingDeltas(deps.db, page.id, page.status),
    loadViewerReported(deps.db, page.id, viewer),
  ])
  return { kills, mvp: page.status === "finished" ? computeMvp(players) : null, demo, ratingDeltas, viewerReported }
}
