import { MatchEventSchema, type MatchEvent } from "@rushsite/shared"
import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, finishVeto, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { demos, gsltTokens, matchMaps, matchPlayers, matchRounds, matches, ratingEvents, serverSlots } from "../../db/schema.js"
import type { MapResultEvent, MatchResultEvent } from "./flow.js"
import { buildMatchPage } from "./match-page.js"
import { padMaps, seriesWinner } from "./series.js"
import { MatchWatchdog, SERIES_MAP_GAP_MIN, type WatchdogDeps } from "./watchdog.js"

async function row(h: Harness, matchId: string) {
  return (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!
}

const stats = (steamId: string, kills: number) => ({ steamId, kills, deaths: 5, headshots: 2, damage: kills * 100 })

describe("series helpers", () => {
  it("pads a short veto list and finds the winner at the needed wins", () => {
    expect(padMaps(["a", "b", "c"], 3)).toEqual(["a", "b", "c"])
    expect(padMaps(["a", "b", "c"], 5)).toEqual(["a", "b", "c", "c", "c"])
    expect(seriesWinner(3, { A: 1, B: 1 })).toBeNull()
    expect(seriesWinner(3, { A: 2, B: 1 })).toBe("A")
    expect(seriesWinner(5, { A: 2, B: 3 })).toBe("B")
  })

  it("gives a series the watchdog cap per remaining map plus the level changes", () => {
    const w = new MatchWatchdog({ options: { maxDurationMin: { aim1v1: 60, aim2v2: 60, rush3v3: 40 } } } as unknown as WatchdogDeps)
    const startedAt = new Date(0)
    const base = { mode: "rush3v3", startedAt, readyAt: null, allocationStartedAt: null, createdAt: startedAt } as const
    type Row = Parameters<MatchWatchdog["deadline"]>[0]
    expect(w.deadline({ ...base, bestOf: 1, gameNumber: 1 } as unknown as Row)).toBe(40 * 60_000)
    expect(w.deadline({ ...base, bestOf: 3, gameNumber: 1 } as unknown as Row)).toBe((120 + 2 * SERIES_MAP_GAP_MIN) * 60_000)
    expect(w.deadline({ ...base, bestOf: 3, gameNumber: 3 } as unknown as Row)).toBe(40 * 60_000)
  })

  it("accepts map_load_failed, draws and overtime in webhooks", () => {
    expect(MatchEventSchema.parse({ type: "match_abandoned", reason: "map_load_failed", missingSteamIds: [] })).toBeTruthy()
    expect(MatchEventSchema.parse({ type: "map_end", mapNumber: 1, mapId: "rush_001", winnerTeam: "draw", score: { A: 7, B: 7 }, players: [], demoUploaded: false })).toBeTruthy()
  })

  it("accepts overtime scores and map numbers in webhooks", () => {
    const end = { type: "map_end", mapNumber: 2, mapId: "aim_map", winnerTeam: "A", score: { A: 16, B: 14 }, players: [], demoUploaded: false }
    expect(MatchEventSchema.parse(end)).toMatchObject({ score: { A: 16, B: 14 } })
    expect(MatchEventSchema.parse({ type: "round_end", round: 30, winnerTeam: "B", score: { A: 16, B: 14 }, mapNumber: 3 })).toBeTruthy()
    expect(MatchEventSchema.safeParse({ ...end, mapNumber: 0 }).success).toBe(false)
  })
})

describe("best-of series on one server", () => {
  let h: Harness
  let results: MatchResultEvent[]
  let mapResults: MapResultEvent[]
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0, demoRecording: true })
    await withServers(h)
    results = []
    mapResults = []
    h.ctx.flow.onResult(async (r) => {
      results.push(r)
    })
    h.ctx.flow.onMapResult(async (r) => {
      mapResults.push(r)
    })
  })
  afterEach(async () => {
    await h.close()
  })

  const event = (matchId: string, e: MatchEvent) => h.ctx.flow.handleEvent(matchId, e)

  async function bo3(opts: { gameNumber?: number; priorMaps?: { mapNumber: number; winnerTeam: string; matchId: string }[]; tournamentId?: string } = {}) {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const { matchId } = await h.ctx.flow.createTournamentMatch({
      mode: "aim1v1",
      teams: [
        { name: "A", steamIds: [a] },
        { name: "B", steamIds: [b] },
      ],
      source: {
        kind: "tournament",
        tournamentId: opts.tournamentId ?? crypto.randomUUID(),
        bracketMatchId: "r3m0",
        gameNumber: opts.gameNumber ?? 1,
        bestOf: 3,
        ...(opts.priorMaps ? { priorMaps: opts.priorMaps } : {}),
      },
    })
    await finishVeto(h, matchId)
    return { matchId, a, b }
  }

  async function playMap(matchId: string, n: number, winner: "A" | "B", a: string, b: string) {
    const m = await row(h, matchId)
    await event(matchId, { type: "match_started", mapNumber: n })
    await event(matchId, { type: "round_end", round: 1, winnerTeam: winner, score: { A: winner === "A" ? 1 : 0, B: winner === "B" ? 1 : 0 }, mapNumber: n })
    const score = winner === "A" ? { A: 16, B: 14 } : { A: 9, B: 13 }
    await event(matchId, {
      type: "map_end",
      mapNumber: n,
      mapId: padMaps(m.maps ?? [], 3)[n - 1]!,
      winnerTeam: winner,
      score,
      players: [stats(a, 10 + n), stats(b, 5)],
      demoUploaded: false,
    })
  }

  async function slotOf(matchId: string) {
    return h.db.select().from(serverSlots).where(eq(serverSlots.matchId, matchId))
  }

  it("allocates once, keeps the slot across maps and releases it after the last demo", async () => {
    const { matchId, a, b } = await bo3()
    expect(h.agent.started).toHaveLength(1)
    const req = h.agent.started[0]!
    expect(req.series).toMatchObject({ bestOf: 3, startMapNumber: 1, wins: { A: 0, B: 0 } })
    expect(req.series!.maps).toHaveLength(3)
    expect(req.series!.demoUploads!.map((d) => d.key)).toEqual([1, 2, 3].map((n) => expect.stringContaining(`${matchId}_m${n}.dem`)))
    expect(req.map.id).toBe(req.series!.maps[0]!.id)
    expect(req.demoUpload!.key).toBe(req.series!.demoUploads![0]!.key)
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(3)

    await event(matchId, { type: "server_ready" })
    await event(matchId, { type: "player_connected", steamId: a })
    await event(matchId, { type: "player_connected", steamId: b })
    await playMap(matchId, 1, "A", a, b)
    let m = await row(h, matchId)
    expect(m).toMatchObject({ status: "live", score: { A: 1, B: 0 }, mapId: req.series!.maps[1]!.id })
    expect(await slotOf(matchId)).toHaveLength(1)
    expect(h.agent.stopped).toEqual([])
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(mapResults).toEqual([{ matchId, mapNumber: 1, winnerTeam: "A" }])

    await playMap(matchId, 2, "B", a, b)
    await playMap(matchId, 3, "A", a, b)
    m = await row(h, matchId)
    expect(m).toMatchObject({ status: "finished", winnerTeam: "A", score: { A: 2, B: 1 }, ratingApplied: true })
    expect(h.agent.started).toHaveLength(1)
    // Rated once for the series
    expect(await h.db.select().from(ratingEvents)).toHaveLength(2)
    expect(results).toEqual([
      {
        matchId,
        outcome: "completed",
        winnerTeam: "A",
        score: { A: 2, B: 1 },
        maps: [
          { mapNumber: 1, winnerTeam: "A", matchId },
          { mapNumber: 2, winnerTeam: "B", matchId },
          { mapNumber: 3, winnerTeam: "A", matchId },
        ],
      },
    ])
    // Rounds restart per map and totals cover the whole series
    expect(await h.db.select().from(matchRounds).where(eq(matchRounds.matchId, matchId))).toHaveLength(3)
    const [pa] = await h.db.select().from(matchPlayers).where(and(eq(matchPlayers.matchId, matchId), eq(matchPlayers.steamId, a)))
    expect(pa).toMatchObject({ won: true, kills: 11 + 12 + 13 })
    const update = h.notifier.ofType("match_update").at(-1)!.msg.payload as { maps?: { status: string }[] }
    expect(update.maps?.map((x) => x.status)).toEqual(["done", "done", "done"])

    // The plugin's own series result is a replay once the API decided it
    await event(matchId, { type: "match_end", winnerTeam: "A", score: { A: 2, B: 1 }, players: [], demoUploaded: false })
    expect(await h.db.select().from(ratingEvents)).toHaveLength(2)

    // An early map's upload does not stop the server. The last one does
    await event(matchId, { type: "demo_uploaded", ok: true, mapNumber: 2 })
    expect(h.agent.stopped).toEqual([])
    await event(matchId, { type: "demo_uploaded", ok: true, mapNumber: 3 })
    expect(h.agent.stopped).toEqual([matchId])
    expect(await slotOf(matchId)).toHaveLength(0)
    expect(await h.db.select().from(gsltTokens).where(eq(gsltTokens.matchId, matchId))).toHaveLength(0)
    const uploaded = await h.db.select().from(demos).where(eq(demos.matchId, matchId))
    expect(uploaded.filter((d) => d.uploaded).map((d) => d.mapNumber).sort()).toEqual([2, 3])
  })

  it("adds the live map's kills to the finished maps on the scoreboard", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await playMap(matchId, 1, "A", a, b)
    await event(matchId, { type: "match_started", mapNumber: 2 })
    const kill = (round: number, tick: number, attacker: string, victim: string) =>
      event(matchId, { type: "kill", round, tick, attacker, victim, weapon: "ak47", headshot: true, wallbang: false, mapNumber: 2 })
    await kill(1, 10, a, b)
    await event(matchId, { type: "round_end", round: 1, winnerTeam: "A", score: { A: 1, B: 0 }, mapNumber: 2 })
    // Round 2 is still running, so its kill stays out
    await kill(2, 20, b, a)

    const page = (await buildMatchPage(h.ctx, matchId, null))!
    const line = (id: string) => page.teams.flatMap((t) => t.players).find((p) => p.steamId === id)!
    // Map 1 from map_end (a 11 kills, b 5, 5 deaths each), plus the ended round of map 2
    expect(line(a)).toMatchObject({ kills: 12, deaths: 5, headshots: 3, damage: 1100 })
    expect(line(b)).toMatchObject({ kills: 5, deaths: 6, headshots: 2, damage: 500 })
    const map2 = page.maps!.find((m) => m.mapNumber === 2)!
    expect(map2.players!.find((p) => p.steamId === a)).toMatchObject({ kills: 1, deaths: 0, headshots: 1, damage: 0 })
    expect(map2.players!.find((p) => p.steamId === b)).toMatchObject({ kills: 0, deaths: 1, damage: 0 })
    expect(page.maps!.find((m) => m.mapNumber === 1)!.players!.find((p) => p.steamId === a)).toMatchObject({ kills: 11 })
  })

  it("ends a 2-0 series early and drops the unplayed map's demo", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await playMap(matchId, 1, "B", a, b)
    await playMap(matchId, 2, "B", a, b)
    expect(await row(h, matchId)).toMatchObject({ status: "finished", winnerTeam: "B", score: { A: 0, B: 2 } })
    const rows = await h.db.select().from(demos).where(eq(demos.matchId, matchId))
    expect(rows.map((d) => d.mapNumber).sort()).toEqual([1, 2])
    await event(matchId, { type: "demo_uploaded", ok: true, mapNumber: 2 })
    expect(h.agent.stopped).toEqual([matchId])
  })

  it("takes the plugin's map list when map_end webhooks were lost", async () => {
    const { matchId } = await bo3()
    await event(matchId, { type: "server_ready" })
    await event(matchId, { type: "match_started", mapNumber: 1 })
    await event(matchId, {
      type: "match_end",
      winnerTeam: "B",
      score: { A: 0, B: 2 },
      players: [],
      demoUploaded: false,
      maps: [
        { mapNumber: 1, mapId: "x", winnerTeam: "B", score: { A: 10, B: 13 } },
        { mapNumber: 2, mapId: "y", winnerTeam: "B", score: { A: 14, B: 16 } },
      ],
    })
    expect(await row(h, matchId)).toMatchObject({ status: "finished", winnerTeam: "B", score: { A: 0, B: 2 }, ratingApplied: true })
    const maps = await h.db.select().from(matchMaps).where(eq(matchMaps.matchId, matchId))
    expect(maps.map((x) => [x.mapNumber, x.status, x.winnerTeam])).toEqual([
      [1, "done", "B"],
      [2, "done", "B"],
    ])
  })

  it("an admin cancel mid series stops the server and frees the slot at once", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await playMap(matchId, 1, "A", a, b)
    expect(await h.ctx.flow.cancelMatch(matchId, "tournament_cancelled", { requeue: false })).toBe(true)
    expect(h.agent.stopped).toEqual([matchId])
    expect(await slotOf(matchId)).toHaveLength(0)
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(results.at(-1)).toMatchObject({ outcome: "cancelled" })
  })

  it("a forfeit mid series rates once and releases after the demo wait", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await event(matchId, { type: "player_connected", steamId: a })
    await event(matchId, { type: "player_connected", steamId: b })
    await playMap(matchId, 1, "A", a, b)
    await event(matchId, { type: "match_abandoned", reason: "left", missingSteamIds: [b] })
    expect(await row(h, matchId)).toMatchObject({ status: "abandoned", winnerTeam: "A" })
    expect(results.at(-1)).toMatchObject({ outcome: "abandoned", missingSteamIds: [b] })
    expect(h.agent.stopped).toEqual([])
    h.clock.advance((h.env.DEMO_WAIT_SEC + 1) * 1000)
    await h.ctx.flow.allocationTick()
    expect(h.agent.stopped).toEqual([matchId])
    expect(await slotOf(matchId)).toHaveLength(0)
  })

  it("resumes a crashed series from the next map with the earlier wins", async () => {
    const tournamentId = crypto.randomUUID()
    const first = await bo3({ tournamentId })
    await event(first.matchId, { type: "server_ready" })
    await playMap(first.matchId, 1, "A", first.a, first.b)
    await event(first.matchId, { type: "match_abandoned", reason: "server_crashed", missingSteamIds: [] })
    expect(await row(h, first.matchId)).toMatchObject({ status: "cancelled" })
    const firstMaps = (await row(h, first.matchId)).maps

    const { matchId } = await bo3({ tournamentId, gameNumber: 2, priorMaps: [{ mapNumber: 1, winnerTeam: "A", matchId: first.matchId }] })
    const req = h.agent.started.at(-1)!
    expect(req.matchId).toBe(matchId)
    expect(req.series).toMatchObject({ startMapNumber: 2, wins: { A: 1, B: 0 } })
    expect(req.map.id).toBe(firstMaps![1])
    expect((await row(h, matchId)).score).toEqual({ A: 1, B: 0 })
    // Map 1 was played on the crashed server, so only maps 2 and 3 get a demo row
    expect((await h.db.select().from(demos).where(eq(demos.matchId, matchId))).map((d) => d.mapNumber).sort()).toEqual([2, 3])

    await event(matchId, { type: "server_ready" })
    const [a, b] = (await row(h, matchId)).teams.map((t) => t.steamIds[0]!) as [string, string]
    await playMap(matchId, 2, "A", a, b)
    expect(await row(h, matchId)).toMatchObject({ status: "finished", winnerTeam: "A", score: { A: 2, B: 0 } })
    expect(results.at(-1)).toMatchObject({
      outcome: "completed",
      maps: [
        { mapNumber: 1, winnerTeam: "A", matchId: first.matchId },
        { mapNumber: 2, winnerTeam: "A", matchId },
      ],
    })
  })

  it("players reloading between maps is no forfeit", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await event(matchId, { type: "player_connected", steamId: a })
    await event(matchId, { type: "player_connected", steamId: b })
    await playMap(matchId, 1, "A", a, b)
    await event(matchId, { type: "player_disconnected", steamId: a })
    await event(matchId, { type: "player_disconnected", steamId: b })
    h.clock.advance((h.env.CONNECT_TIMEOUT_SEC + 120) * 1000)
    await h.ctx.flow.tick()
    expect(await row(h, matchId)).toMatchObject({ status: "live" })
    await event(matchId, { type: "player_connected", steamId: a })
    await event(matchId, { type: "player_connected", steamId: b })
    await playMap(matchId, 2, "A", a, b)
    expect(await row(h, matchId)).toMatchObject({ status: "finished", winnerTeam: "A" })
  })

  it("a map that fails to load ends the series like a crash and frees the server", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await playMap(matchId, 1, "A", a, b)
    await event(matchId, { type: "match_abandoned", reason: "map_load_failed", missingSteamIds: [] })
    expect(await row(h, matchId)).toMatchObject({ status: "cancelled", cancelReason: "map_load_failed" })
    expect(h.agent.stopped).toEqual([matchId])
    expect(await slotOf(matchId)).toHaveLength(0)
    expect(results.at(-1)).toMatchObject({ outcome: "cancelled", reason: "map_load_failed" })
  })

  it("a drawn map counts for nobody and a level series ends unrated", async () => {
    const { matchId, a, b } = await bo3()
    await event(matchId, { type: "server_ready" })
    await playMap(matchId, 1, "A", a, b)
    const m = await row(h, matchId)
    await event(matchId, { type: "map_end", mapNumber: 2, mapId: m.maps![1]!, winnerTeam: "draw", score: { A: 7, B: 7 }, players: [], demoUploaded: false })
    expect(await row(h, matchId)).toMatchObject({ status: "live", score: { A: 1, B: 0 } })
    await playMap(matchId, 3, "B", a, b)
    await event(matchId, {
      type: "match_end",
      winnerTeam: "draw",
      score: { A: 1, B: 1 },
      players: [],
      demoUploaded: false,
    })
    expect(await row(h, matchId)).toMatchObject({ status: "finished", winnerTeam: null, score: { A: 1, B: 1 }, ratingApplied: false })
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(results.at(-1)).toMatchObject({ outcome: "completed", winnerTeam: "draw", maps: [{ mapNumber: 1 }, { mapNumber: 3 }] })
  })

  it("leaves single map matches as they were", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const { matchId } = await h.ctx.flow.createTournamentMatch({
      mode: "aim1v1",
      teams: [
        { name: "A", steamIds: [a] },
        { name: "B", steamIds: [b] },
      ],
      source: { kind: "tournament", tournamentId: crypto.randomUUID(), bracketMatchId: "r1m0", gameNumber: 1, bestOf: 1 },
    })
    await finishVeto(h, matchId)
    expect(h.agent.started.at(-1)!.series).toBeUndefined()
    await event(matchId, { type: "server_ready" })
    await event(matchId, { type: "match_started" })
    await event(matchId, { type: "match_end", winnerTeam: "A", score: { A: 16, B: 14 }, players: [], demoUploaded: false })
    expect(await row(h, matchId)).toMatchObject({ status: "finished", score: { A: 16, B: 14 } })
    expect(results.at(-1)).not.toHaveProperty("maps")
  })
})
