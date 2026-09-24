import { PGlite } from "@electric-sql/pglite"
import { BracketSchema } from "@rushsite/shared"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { describe, expect, it } from "vitest"
import { MIGRATIONS_DIR } from "../../db/client.js"
import { matchMaps, matches } from "../../db/schema.js"
import {
  type BestOfRule,
  type Bracket,
  buildBracket,
  forfeit,
  recordGame,
  recordMap,
  recordSeries,
  startGame,
} from "./bracket.js"
import { gameMatchIds, withScores } from "./scores.js"
import { DrizzleTournamentStore, type GameScoreRecord } from "./store.js"
import type { Db } from "./types.js"

const RULE: BestOfRule = { default: 1, semis: 1, final: 3 }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const entry = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`

// Four entries give two Bo1 semis and a Bo3 final
function four(): Bracket {
  return buildBracket(
    [1, 2, 3, 4].map((n) => ({ id: entry(n), rating: 2000 - n })),
    RULE,
  )
}

function game(matchId: string, over: Partial<GameScoreRecord> = {}): GameScoreRecord {
  return { matchId, slug: null, status: "finished", mapId: "aim_map", score: null, maps: [], ...over }
}

function view(b: Bracket, games: GameScoreRecord[]) {
  const v = withScores(b, games)
  BracketSchema.parse(v)
  return (key: string) => v.matches.find((m) => m.id === key)!
}

describe("bracket scores", () => {
  it("shows the round score of a finished Bo1 and links its room", () => {
    let b = four()
    b = startGame(b, "r1m0", id(1))
    b = recordGame(b, "r1m0", id(1), "a")
    const m = view(b, [game(id(1), { slug: "brave-amber-falcon", score: { A: 16, B: 14 } })])
    expect(m("r1m0")).toMatchObject({ score: { a: 16, b: 14 }, room: "brave-amber-falcon", status: "done" })
    expect(m("r1m0").maps).toBeUndefined()
    expect(m("r1m1")).toMatchObject({ score: null, room: null })
  })

  it("shows the live score of a Bo1 and falls back to the match id without a room id", () => {
    let b = four()
    b = startGame(b, "r1m1", id(2))
    const m = view(b, [game(id(2), { status: "live", score: { A: 5, B: 7 } })])
    expect(m("r1m1")).toMatchObject({ status: "live", score: { a: 5, b: 7 }, room: id(2) })
  })

  it("has no score before the first round ends", () => {
    let b = four()
    b = startGame(b, "r1m1", id(2))
    expect(view(b, [game(id(2), { status: "live", score: null })])("r1m1").score).toBeNull()
  })

  it("gives a Bo3 final the series score and each map's round score", () => {
    let b = four()
    for (const [key, n] of [["r1m0", 1], ["r1m1", 2]] as const) {
      b = startGame(b, key, id(n))
      b = recordGame(b, key, id(n), "a")
    }
    b = startGame(b, "r2m0", id(10))
    b = recordMap(b, "r2m0", id(10), 1, "b")
    const live = view(b, [
      game(id(10), {
        status: "live",
        slug: "calm-iron-owl",
        score: { A: 0, B: 1 },
        maps: [
          { mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "B", score: { A: 9, B: 13 }, playedIn: null },
          { mapNumber: 2, mapId: "aim_redline", status: "live", winnerTeam: null, score: { A: 4, B: 2 }, playedIn: null },
        ],
      }),
    ])("r2m0")
    expect(live).toMatchObject({ status: "live", score: { a: 0, b: 1 }, room: "calm-iron-owl" })
    expect(live.maps).toEqual([
      { mapNumber: 1, mapId: "aim_map", status: "done", score: { a: 9, b: 13 }, winner: "b" },
      { mapNumber: 2, mapId: "aim_redline", status: "live", score: { a: 4, b: 2 }, winner: null },
    ])
  })

  it("keeps map scores of a series that resumed on a new server", () => {
    let b = four()
    for (const [key, n] of [["r1m0", 1], ["r1m1", 2]] as const) {
      b = startGame(b, key, id(n))
      b = recordGame(b, key, id(n), "a")
    }
    b = startGame(b, "r2m0", id(10))
    b = recordMap(b, "r2m0", id(10), 1, "b")
    // Server crash. The series restarts on id(11) with map 1 carried over
    b = { ...b, matches: b.matches.map((m) => (m.id === "r2m0" ? { ...m, status: "ready", liveMatchId: null } : m)) }
    b = startGame(b, "r2m0", id(11))
    b = recordSeries(
      b,
      "r2m0",
      id(11),
      [
        { map: 2, winner: "a", matchId: id(11) },
        { map: 3, winner: "a", matchId: id(11) },
      ],
      "a",
    )
    expect(gameMatchIds(b)).toEqual(expect.arrayContaining([id(10), id(11)]))
    const final = view(b, [
      game(id(10), {
        status: "cancelled",
        maps: [{ mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "B", score: { A: 11, B: 13 }, playedIn: null }],
      }),
      game(id(11), {
        slug: "quiet-violet-hawk",
        score: { A: 2, B: 1 },
        maps: [
          { mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "B", score: {}, playedIn: id(10) },
          { mapNumber: 2, mapId: "aim_usp", status: "done", winnerTeam: "A", score: { A: 13, B: 7 }, playedIn: null },
          { mapNumber: 3, mapId: "awp_india", status: "done", winnerTeam: "A", score: { A: 16, B: 14 }, playedIn: null },
        ],
      }),
    ])("r2m0")
    expect(final).toMatchObject({ status: "done", resolution: "played", score: { a: 2, b: 1 }, room: "quiet-violet-hawk" })
    expect(final.maps?.map((x) => [x.mapNumber, x.mapId, x.score, x.winner])).toEqual([
      [1, "aim_map", { a: 11, b: 13 }, "b"],
      [2, "aim_usp", { a: 13, b: 7 }, "a"],
      [3, "awp_india", { a: 16, b: 14 }, "a"],
    ])
  })

  it("builds maps from per game matches of older series", () => {
    let b = four()
    for (const [key, n] of [["r1m0", 1], ["r1m1", 2]] as const) {
      b = startGame(b, key, id(n))
      b = recordGame(b, key, id(n), "a")
    }
    b = startGame(b, "r2m0", id(20))
    b = recordGame(b, "r2m0", id(20), "a")
    b = startGame(b, "r2m0", id(21))
    const m = view(b, [game(id(20), { score: { A: 13, B: 3 } }), game(id(21), { status: "live", mapId: "aim_usp", score: { A: 1, B: 0 } })])("r2m0")
    expect(m).toMatchObject({ score: { a: 1, b: 0 }, room: id(21) })
    expect(m.maps).toEqual([
      { mapNumber: 1, mapId: "aim_map", status: "done", score: { a: 13, b: 3 }, winner: "a" },
      { mapNumber: 2, mapId: "aim_usp", status: "live", score: { a: 1, b: 0 }, winner: null },
    ])
  })

  it("has no score or room after a forfeit", () => {
    let b = four()
    b = startGame(b, "r1m0", id(1))
    b = forfeit(b, "r1m0", ["b"])
    const m = view(b, [game(id(1), { status: "abandoned", score: { A: 3, B: 1 } })])("r1m0")
    expect(m).toMatchObject({ status: "done", resolution: "forfeit", winner: entry(1), score: null, room: null })
  })

  it("has no score on byes and matches not yet played", () => {
    const b = buildBracket(
      [1, 2, 3].map((n) => ({ id: entry(n), rating: 2000 - n })),
      RULE,
    )
    const m = view(b, [])
    const bye = b.matches.find((x) => x.resolution === "bye")!
    expect(m(bye.id)).toMatchObject({ score: null, room: null })
    expect(m("r2m0")).toMatchObject({ score: null, maps: [], room: null })
  })
})

describe("drizzle game scores", () => {
  it("reads match scores and map rows in one query", async () => {
    const client = new PGlite()
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR })
      const db = drizzle(client) as unknown as Db
      const teams = [
        { name: "A", steamIds: ["76561198000000001"] },
        { name: "B", steamIds: ["76561198000000002"] },
      ]
      const base = { mode: "aim1v1" as const, source: "tournament" as const, teams, webhookSecret: "x" }
      await db.insert(matches).values([
        { ...base, id: id(1), slug: "brave-amber-falcon", status: "finished", mapId: "aim_map", score: { A: 13, B: 9 } },
        { ...base, id: id(2), status: "live", mapId: "aim_usp", score: { A: 1, B: 0 }, bestOf: 3 },
      ])
      await db.insert(matchMaps).values([
        { matchId: id(2), mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "A", score: { A: 13, B: 5 } },
        { matchId: id(2), mapNumber: 2, mapId: "aim_usp", status: "live", score: { A: 2, B: 2 } },
      ])
      const store = new DrizzleTournamentStore(db)
      const rows = await store.gameScores([id(1), id(2), id(2), id(3), "not-a-uuid"])
      const byId = new Map(rows.map((r) => [r.matchId, r]))
      expect(rows).toHaveLength(2)
      expect(byId.get(id(1))).toEqual({ matchId: id(1), slug: "brave-amber-falcon", status: "finished", mapId: "aim_map", score: { A: 13, B: 9 }, maps: [] })
      expect(byId.get(id(2))?.maps.sort((x, y) => x.mapNumber - y.mapNumber)).toEqual([
        { mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "A", score: { A: 13, B: 5 }, playedIn: null },
        { mapNumber: 2, mapId: "aim_usp", status: "live", winnerTeam: null, score: { A: 2, B: 2 }, playedIn: null },
      ])
      expect(await store.gameScores([])).toEqual([])
    } finally {
      await client.close()
    }
  }, 30_000)
})
