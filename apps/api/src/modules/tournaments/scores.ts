// Adds round and map scores to the bracket view. No IO.
import type { BracketMapScore, BracketScore, BracketView } from "@rushsite/shared"
import { type Bracket, type BracketMatch, type Side, seriesScore } from "./bracket.js"
import type { GameScoreRecord } from "./store.js"

// Team names the tournaments module gives each side of a bracket game
const TEAM: Record<Side, string> = { a: "A", b: "B" }

function sideScore(score: Record<string, number> | null | undefined): BracketScore | null {
  if (!score) return null
  const a = score[TEAM.a]
  const b = score[TEAM.b]
  if (a === undefined && b === undefined) return null
  return { a: Math.max(0, Math.trunc(a ?? 0)), b: Math.max(0, Math.trunc(b ?? 0)) }
}

function sideOf(team: string | null): Side | null {
  if (team === TEAM.a) return "a"
  if (team === TEAM.b) return "b"
  return null
}

// Every CS2 match a bracket match ran on. The live one last
export function gameMatchIds(bracket: Bracket): string[] {
  const ids = new Set<string>()
  for (const m of bracket.matches) {
    for (const g of m.games) ids.add(g.matchId)
    if (m.liveMatchId) ids.add(m.liveMatchId)
  }
  return [...ids]
}

function latestMatchId(m: BracketMatch): string | null {
  return m.liveMatchId ?? m.games.at(-1)?.matchId ?? null
}

// Map rows of a series across every server it used. The row where the map was played wins
function seriesMaps(m: BracketMatch, byId: Map<string, GameScoreRecord>): BracketMapScore[] {
  const ids = [...new Set([...m.games.map((g) => g.matchId), ...(m.liveMatchId ? [m.liveMatchId] : [])])]
  const byMap = new Map<number, GameScoreRecord["maps"][number]>()
  for (const id of ids) {
    for (const row of byId.get(id)?.maps ?? []) {
      const cur = byMap.get(row.mapNumber)
      const better =
        !cur ||
        (cur.playedIn !== null && row.playedIn === null) ||
        (cur.playedIn === row.playedIn && cur.status !== "done" && row.status === "done")
      if (better) byMap.set(row.mapNumber, row)
    }
  }
  if (byMap.size > 0) {
    return [...byMap.values()]
      .sort((x, y) => x.mapNumber - y.mapNumber)
      .map((row) => ({
        mapNumber: row.mapNumber,
        mapId: row.mapId || null,
        status: row.status === "done" ? "done" : "live",
        score: sideScore(row.score) ?? { a: 0, b: 0 },
        winner: row.status === "done" ? sideOf(row.winnerTeam) : null,
      }))
  }
  // Older series played every map as its own match
  const maps: BracketMapScore[] = m.games.map((g, i) => {
    const rec = byId.get(g.matchId)
    return {
      mapNumber: g.map ?? i + 1,
      mapId: rec?.mapId ?? null,
      status: "done",
      score: sideScore(rec?.score) ?? { a: 0, b: 0 },
      winner: g.winner,
    }
  })
  const live = m.liveMatchId ? byId.get(m.liveMatchId) : undefined
  if (live && !m.games.some((g) => g.matchId === live.matchId)) {
    maps.push({
      mapNumber: maps.length + 1,
      mapId: live.mapId,
      status: "live",
      score: sideScore(live.score) ?? { a: 0, b: 0 },
      winner: null,
    })
  }
  return maps
}

export function withScores(bracket: Bracket, games: GameScoreRecord[]): BracketView {
  const byId = new Map(games.map((g) => [g.matchId, g]))
  return {
    size: bracket.size,
    rounds: bracket.rounds,
    matches: bracket.matches.map((m) => {
      const latest = latestMatchId(m)
      const rec = latest ? byId.get(latest) : undefined
      const room = latest ? (rec?.slug ?? latest) : null
      const view = { ...m, games: m.games.map((g) => ({ matchId: g.matchId, winner: g.winner })), room }
      if (m.bestOf > 1) {
        const maps = seriesMaps(m, byId)
        const played = m.games.length > 0 || maps.length > 0
        return { ...view, score: played ? seriesScore(m) : null, maps }
      }
      return { ...view, score: sideScore(rec?.score) }
    }),
  }
}
