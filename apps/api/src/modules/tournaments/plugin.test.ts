import { ServerMessageSchema, TournamentBracketResponseSchema } from "@rushsite/shared"
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { type CupDefinition, DEFAULT_CUPS } from "./config.js"
import tournamentsPlugin from "./index.js"
import { MemoryTournamentStore } from "./memory-store.js"
import type { TournamentService } from "./service.js"
import type {
  EmitAudience,
  MapResult,
  MapResultHandler,
  MatchResult,
  MatchResultHandler,
  PartyInfo,
  StartMatchParams,
  TournamentUpdatePayload,
  TrustLevel,
  WsMessage,
} from "./types.js"

const T0 = new Date("2026-09-23T12:00:00Z")
const cup = (key: string) => DEFAULT_CUPS.find((c) => c.key === key) as CupDefinition

async function harness(cups: CupDefinition[]) {
  const store = new MemoryTournamentStore()
  const clock = { now: T0 }
  const started: (StartMatchParams & { matchId: string })[] = []
  const emitted: WsMessage<TournamentUpdatePayload>[] = []
  const trust: Record<string, TrustLevel> = {}
  const ratings: Record<string, number> = {}
  const parties: PartyInfo[] = []
  const failStart = { value: false }
  const audiences: (EmitAudience | undefined)[] = []
  // Test hook that runs inside startMatch.
  const onStart: { fn?: (p: StartMatchParams) => Promise<void> } = {}
  let handler: MatchResultHandler | undefined
  let mapHandler: MapResultHandler | undefined
  let service: TournamentService | undefined
  let seq = 0

  const app: FastifyInstance = Fastify()
  await app.register(tournamentsPlugin, {
    db: undefined as never,
    store,
    onService: (s) => {
      service = s
    },
    cups,
    scheduler: false,
    now: () => clock.now,
    startMatch: async (p) => {
      await onStart.fn?.(p)
      if (failStart.value) throw new Error("no free slots")
      const matchId = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`
      started.push({ ...p, matchId })
      return { matchId }
    },
    onMatchResult: (h) => {
      handler = h
    },
    onMapResult: (h) => {
      mapHandler = h
    },
    emit: (m, audience) => {
      emitted.push(m)
      audiences.push(audience)
    },
    authenticate: async (req) => (req.headers["x-steam-id"] as string | undefined) ?? null,
    getTrustLevels: async (ids) => Object.fromEntries(ids.map((id) => [id, trust[id] ?? "new"])),
    getRatings: async (ids) =>
      Object.fromEntries(ids.filter((id) => id in ratings).map((id) => [id, ratings[id]!])),
    getProfiles: async (ids) =>
      Object.fromEntries(
        ids.filter((id) => id !== "p5").map((id) => [id, { displayName: `N-${id}`, avatarUrl: `https://a/${id}` }]),
      ),
    getParty: async (id) => parties.find((p) => p.memberSteamIds.includes(id)) ?? null,
  })
  await app.ready()

  return {
    app,
    store,
    clock,
    started,
    emitted,
    trust,
    ratings,
    parties,
    failStart,
    audiences,
    onStart,
    tick: () => (service as TournamentService).tick(),
    result: (r: MatchResult) => (handler as MatchResultHandler)(r),
    mapResult: (r: MapResult) => (mapHandler as MapResultHandler)(r),
    enter: (id: string, steamId?: string) =>
      app.inject({
        method: "POST",
        url: `/tournaments/${id}/enter`,
        headers: steamId ? { "x-steam-id": steamId } : {},
      }),
    withdraw: (id: string, steamId: string) =>
      app.inject({
        method: "DELETE",
        url: `/tournaments/${id}/enter`,
        headers: { "x-steam-id": steamId },
      }),
    only: () => {
      const all = [...store.tournaments.values()]
      if (all.length !== 1) throw new Error(`expected one tournament, got ${all.length}`)
      return all[0]!
    },
    // Moves the clock past the tournament start and ticks.
    startNow: async (startsAt: Date) => {
      clock.now = new Date(startsAt.getTime() + 1000)
      await (service as TournamentService).startDue()
    },
  }
}

type H = Awaited<ReturnType<typeof harness>>
let h: H

afterEach(async () => {
  // Every emitted event must match the shared ws schema.
  for (const m of h?.emitted ?? []) ServerMessageSchema.parse(m)
  await h?.app.close()
})

function verify(...ids: string[]) {
  for (const id of ids) h.trust[id] = "verified"
}

function liveGame(bracketMatchId: string) {
  const g = [...h.started].reverse().find((s) => s.source.bracketMatchId === bracketMatchId)
  if (!g) throw new Error(`no game for ${bracketMatchId}`)
  return g
}

async function win(bracketMatchId: string, team: "A" | "B") {
  await h.result({
    matchId: liveGame(bracketMatchId).matchId,
    outcome: "completed",
    winnerTeam: team,
    score: {},
  })
}

function bracket() {
  return [...h.store.brackets.values()][0]?.bracket
}

function bm(id: string) {
  const m = bracket()?.matches.find((x) => x.id === id)
  if (!m) throw new Error(id)
  return m
}

describe("scheduling", () => {
  it("creates the next tournament per cup once", async () => {
    h = await harness(DEFAULT_CUPS)
    await h.tick()
    await h.tick()
    const all = [...h.store.tournaments.values()]
    expect(all).toHaveLength(6)
    const d = all.find((t) => t.cupKey === "daily-aim1v1")
    expect(d?.startsAt.toISOString()).toBe("2026-09-23T18:00:00.000Z")
    const w = all.find((t) => t.cupKey === "weekly-rush3v3")
    expect(w?.startsAt.toISOString()).toBe("2026-09-27T17:00:00.000Z")
    expect(h.emitted.filter((e) => e.payload.kind === "created")).toHaveLength(6)
  })

  it("lists and shows tournaments", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const list = await h.app.inject({ url: "/tournaments?status=open&mode=aim1v1" })
    expect(list.statusCode).toBe(200)
    expect(list.json().tournaments).toHaveLength(1)
    expect(list.json().tournaments[0]).toMatchObject({
      status: "open",
      entrantCount: 0,
      minTrust: "verified",
      entryFee: 0,
      checkIn: false,
      format: { bestOf: { default: 1, semis: 1, final: 3 } },
    })
    const detail = await h.app.inject({ url: `/tournaments/${h.only().id}` })
    expect(detail.json().tournament).toMatchObject({ entries: [], bracket: null })
    expect((await h.app.inject({ url: "/tournaments/not-a-uuid" })).statusCode).toBe(404)
  })

  it("cancels when fewer than two entered", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const t = h.only()
    verify("p1")
    await h.enter(t.id, "p1")
    await h.startNow(t.startsAt)
    expect(h.only().status).toBe("cancelled")
    expect(h.emitted.at(-1)?.payload.kind).toBe("cancelled")
  })
})

describe("sign-up", () => {
  it("requires sign-in, Verified trust, and one entry per player", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const id = h.only().id
    expect((await h.enter(id)).statusCode).toBe(401)
    const low = await h.enter(id, "p1")
    expect(low.statusCode).toBe(403)
    expect(low.json().error).toBe("trust_required")
    verify("p1")
    const ok = await h.enter(id, "p1")
    expect(ok.statusCode).toBe(201)
    expect(ok.json().entry.steamIds).toEqual(["p1"])
    expect(ok.json().entry).toMatchObject({
      name: "N-p1",
      players: [
        { steamId: "p1", displayName: "N-p1", avatarUrl: "https://a/p1", rating: null, tier: "unranked" },
      ],
    })
    expect((await h.enter(id, "p1")).json().error).toBe("already_entered")
    const detail = await h.app.inject({ url: `/tournaments/${id}`, headers: { "x-steam-id": "p1" } })
    expect(detail.json().tournament.myEntryId).toBe(ok.json().entry.id)
    expect(detail.json().tournament.entries[0].name).toBe("N-p1")
    const rows = (k?: string) =>
      h.app
        .inject({ url: "/tournaments", headers: k ? { "x-steam-id": k } : {} })
        .then((r) => r.json().tournaments[0])
    expect((await rows("p1")).myEntryId).toBe(ok.json().entry.id)
    expect((await rows("p9")).myEntryId).toBeNull()
    expect(await rows()).not.toHaveProperty("myEntryId")
    expect(h.emitted.at(-1)?.payload).toMatchObject({ kind: "entries_changed" })
  })

  it("accepts Trusted players and withdraws", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const id = h.only().id
    h.trust.p1 = "trusted"
    expect((await h.enter(id, "p1")).statusCode).toBe(201)
    expect((await h.withdraw(id, "p1")).statusCode).toBe(204)
    expect((await h.withdraw(id, "p1")).statusCode).toBe(404)
    expect(h.store.entries.size).toBe(0)
  })

  it("enforces max entrants", async () => {
    h = await harness([{ ...cup("daily-aim1v1"), maxEntrants: 2 }])
    await h.tick()
    const id = h.only().id
    verify("p1", "p2", "p3")
    await h.enter(id, "p1")
    await h.enter(id, "p2")
    expect((await h.enter(id, "p3")).json().error).toBe("full")
  })

  it("closes sign-ups at start time and before registration opens", async () => {
    h = await harness([cup("weekly-aim1v1")])
    h.clock.now = new Date("2026-09-20T17:30:00Z")
    await h.tick()
    const t = h.only()
    verify("p1")
    // Weekly opens seven days before, so right after creation is fine.
    expect((await h.enter(t.id, "p1")).statusCode).toBe(201)
    h.clock.now = new Date(t.startsAt.getTime())
    verify("p2")
    expect((await h.enter(t.id, "p2")).json().error).toBe("registration_closed")
  })

  it("enters a full party for team cups from the leader only", async () => {
    h = await harness([cup("daily-aim2v2")])
    await h.tick()
    const id = h.only().id
    verify("a1", "a2")
    expect((await h.enter(id, "a1")).json().error).toBe("party_required")
    h.parties.push({ partyId: "p", leaderSteamId: "a1", memberSteamIds: ["a1"] })
    expect((await h.enter(id, "a1")).json().error).toBe("party_size")
    h.parties[0]!.memberSteamIds.push("a2")
    expect((await h.enter(id, "a2")).json().error).toBe("not_party_leader")
    const res = await h.enter(id, "a1")
    expect(res.statusCode).toBe(201)
    expect(res.json().entry.steamIds).toEqual(["a1", "a2"])
    expect(res.json().entry.name).toBe("N-a1")
    expect(res.json().entry.players.map((p: { displayName: string }) => p.displayName)).toEqual([
      "N-a1",
      "N-a2",
    ])
    // Any member can withdraw the team.
    expect((await h.withdraw(id, "a2")).statusCode).toBe(204)
  })
})

describe("running a cup", () => {
  async function fiveEntrants() {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const t = h.only()
    for (let i = 1; i <= 5; i++) {
      verify(`p${i}`)
      h.ratings[`p${i}`] = 2000 - i * 100
    }
    // Sign up in reverse rating order to prove seeding uses rating.
    for (let i = 5; i >= 1; i--) await h.enter(t.id, `p${i}`)
    return t
  }

  function entryOf(steamId: string) {
    return [...h.store.entries.values()].find((e) => e.steamIds.includes(steamId))?.id
  }

  it("seeds by rating, gives byes, forfeits absent players and completes", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    expect(h.only().status).toBe("running")
    const startedAt = h.emitted.findIndex((e) => e.payload.kind === "started")
    expect(h.emitted[startedAt]?.payload).not.toHaveProperty("bracket")
    expect(h.emitted[startedAt]?.payload.bracketVersion).toBeGreaterThan(0)
    expect(h.audiences[startedAt]).toEqual({ kind: "broadcast" })
    const liveAt = h.emitted.findIndex((e) => e.payload.kind === "match_live")
    expect(h.audiences[liveAt]).toEqual({ kind: "tournament", tournamentId: t.id })
    const seeds = [...h.store.entries.values()].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    expect(seeds.map((e) => e.captainSteamId)).toEqual(["p1", "p2", "p3", "p4", "p5"])
    const shown = (await h.app.inject({ url: `/tournaments/${t.id}` })).json().tournament.entries
    // p5 has no profile and falls back to the SteamID.
    type Shown = { captainSteamId: string; name: string; players: { rating: number; tier: string }[] }
    const byCaptain = (id: string) => shown.find((e: Shown) => e.captainSteamId === id) as Shown
    expect(byCaptain("p5").name).toBe("p5")
    expect(byCaptain("p1").players[0]).toMatchObject({ rating: 1900, tier: "platinum" })
    expect(byCaptain("p5").players[0]).toMatchObject({ rating: 1500, tier: "silver" })

    // 4 v 5 in round one and 2 v 3 in round two are provisioned straight away.
    expect(h.started.map((s) => s.source.bracketMatchId).sort()).toEqual(["r1m1", "r2m1"])
    expect(liveGame("r1m1").teams).toEqual([
      { name: "A", steamIds: ["p4"] },
      { name: "B", steamIds: ["p5"] },
    ])
    expect(liveGame("r1m1").source).toMatchObject({ kind: "tournament", gameNumber: 1, bestOf: 1 })

    // p5 never connects. p4 advances on forfeit and meets p1 in the semi.
    await h.result({
      matchId: liveGame("r1m1").matchId,
      outcome: "abandoned",
      reason: "no_show",
      missingSteamIds: ["p5"],
    })
    expect(bm("r1m1").resolution).toBe("forfeit")
    expect(bm("r2m0").b).toBe(entryOf("p4"))
    expect(bm("r2m0").status).toBe("live")

    await win("r2m0", "A") // p1 beats p4
    await win("r2m1", "B") // p3 upsets p2
    expect(bm("r3m0").bestOf).toBe(3)
    expect(liveGame("r3m0").source).toMatchObject({ gameNumber: 1, bestOf: 3 })

    // Bo3 final. p3 takes game one, p1 takes the next two.
    await win("r3m0", "B")
    expect(liveGame("r3m0").source.gameNumber).toBe(2)
    await win("r3m0", "A")
    expect(liveGame("r3m0").source.gameNumber).toBe(3)
    expect(h.only().status).toBe("running")
    await win("r3m0", "A")

    const done = h.only()
    expect(done.status).toBe("completed")
    expect(done.winnerEntryId).toBe(entryOf("p1"))
    const badges = Object.fromEntries(h.store.badges.map((b) => [b.steamId, b.kind]))
    expect(badges).toEqual({
      p1: "cup_champion",
      p3: "cup_runner_up",
      p2: "cup_semifinalist",
      p4: "cup_semifinalist",
    })
    expect(h.emitted.at(-1)?.payload.kind).toBe("completed")
    expect(h.emitted.at(-1)?.type).toBe("tournament_update")
  })

  it("plays a Bo3 final as one series and resumes it on a new server after a crash", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    await h.result({ matchId: liveGame("r1m1").matchId, outcome: "abandoned", reason: "no_show", missingSteamIds: ["p5"] })
    await win("r2m0", "A")
    await win("r2m1", "B")
    const first = liveGame("r3m0")
    expect(first.source).toMatchObject({ gameNumber: 1, bestOf: 3 })
    expect(first.source.priorMaps).toBeUndefined()
    const starts = h.started.length

    // A map result updates the live bracket but asks for no new server
    await h.mapResult({ matchId: first.matchId, mapNumber: 1, winnerTeam: "B" })
    await h.mapResult({ matchId: first.matchId, mapNumber: 1, winnerTeam: "B" })
    expect(bm("r3m0")).toMatchObject({ status: "live", liveMatchId: first.matchId, games: [{ matchId: first.matchId, winner: "b", map: 1 }] })
    expect(h.started).toHaveLength(starts)
    expect(h.emitted.at(-1)?.payload).toMatchObject({ kind: "match_updated", bracketMatchId: "r3m0" })

    // The server dies. The series resumes at map 2 with map 1 kept
    await h.result({ matchId: first.matchId, outcome: "cancelled", reason: "server_crashed" })
    const second = liveGame("r3m0")
    expect(second.matchId).not.toBe(first.matchId)
    expect(second.source).toMatchObject({ gameNumber: 2, bestOf: 3, priorMaps: [{ mapNumber: 1, winnerTeam: "B", matchId: first.matchId }] })

    await h.mapResult({ matchId: second.matchId, mapNumber: 2, winnerTeam: "A" })
    await h.result({
      matchId: second.matchId,
      outcome: "completed",
      winnerTeam: "A",
      score: { A: 2, B: 1 },
      maps: [
        { mapNumber: 1, winnerTeam: "B", matchId: first.matchId },
        { mapNumber: 2, winnerTeam: "A", matchId: second.matchId },
        { mapNumber: 3, winnerTeam: "A", matchId: second.matchId },
      ],
    })
    expect(bm("r3m0")).toMatchObject({ status: "done", resolution: "played", winner: entryOf("p1") })
    expect(bm("r3m0").games.map((g) => [g.map, g.winner])).toEqual([
      [1, "b"],
      [2, "a"],
      [3, "a"],
    ])
    expect(h.only()).toMatchObject({ status: "completed", winnerEntryId: entryOf("p1") })
    expect(h.started).toHaveLength(starts + 1)
  })

  it("replays a series that ended level from its first map", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    await h.result({ matchId: liveGame("r1m1").matchId, outcome: "abandoned", reason: "no_show", missingSteamIds: ["p5"] })
    await win("r2m0", "A")
    await win("r2m1", "B")
    const first = liveGame("r3m0")
    await h.mapResult({ matchId: first.matchId, mapNumber: 1, winnerTeam: "A" })
    await h.mapResult({ matchId: first.matchId, mapNumber: 3, winnerTeam: "B" })
    await h.result({
      matchId: first.matchId,
      outcome: "completed",
      winnerTeam: "draw",
      score: { A: 1, B: 1 },
      maps: [
        { mapNumber: 1, winnerTeam: "A", matchId: first.matchId },
        { mapNumber: 3, winnerTeam: "B", matchId: first.matchId },
      ],
    })
    const again = liveGame("r3m0")
    expect(again.matchId).not.toBe(first.matchId)
    expect(again.source).toMatchObject({ gameNumber: 1, bestOf: 3 })
    expect(again.source.priorMaps).toBeUndefined()
    expect(bm("r3m0").games).toEqual([])
  })

  it("serves round and map scores with room links in one score lookup", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    const lookups: string[][] = []
    const original = h.store.gameScores.bind(h.store)
    h.store.gameScores = async (ids) => {
      lookups.push(ids)
      return original(ids)
    }
    const get = async () => {
      const res = await h.app.inject({ url: `/tournaments/${t.id}/bracket` })
      const body = TournamentBracketResponseSchema.parse(res.json())
      return (key: string) => body.bracket!.matches.find((m) => m.id === key)!
    }
    const forfeited = liveGame("r1m1").matchId
    h.store.games.set(forfeited, { matchId: forfeited, slug: "slow-grey-crow", status: "abandoned", mapId: "aim_map", score: { A: 2, B: 0 }, maps: [] })
    await h.result({ matchId: forfeited, outcome: "abandoned", reason: "no_show", missingSteamIds: ["p5"] })

    // Live Bo1 semi
    const semi = liveGame("r2m1").matchId
    h.store.games.set(semi, { matchId: semi, slug: "brave-amber-falcon", status: "live", mapId: "aim_map", score: { A: 6, B: 4 }, maps: [] })
    let m = await get()
    expect(m("r1m1")).toMatchObject({ resolution: "forfeit", score: null, room: null })
    expect(m("r2m1")).toMatchObject({ status: "live", score: { a: 6, b: 4 }, room: "brave-amber-falcon" })
    expect(lookups).toHaveLength(1)

    h.store.games.set(semi, { ...h.store.games.get(semi)!, status: "completed", score: { A: 14, B: 16 } })
    await win("r2m1", "B")
    const other = liveGame("r2m0").matchId
    h.store.games.set(other, { matchId: other, slug: null, status: "completed", mapId: "aim_map", score: { A: 13, B: 9 }, maps: [] })
    await win("r2m0", "A")
    m = await get()
    expect(m("r2m1")).toMatchObject({ status: "done", score: { a: 14, b: 16 } })
    expect(m("r2m0")).toMatchObject({ score: { a: 13, b: 9 }, room: other })

    // Bo3 final on one server
    const final = liveGame("r3m0").matchId
    const maps = [
      { mapNumber: 1, mapId: "aim_map", status: "done", winnerTeam: "B", score: { A: 10, B: 13 }, playedIn: null },
      { mapNumber: 2, mapId: "aim_usp", status: "live", winnerTeam: null, score: { A: 3, B: 1 }, playedIn: null },
    ]
    h.store.games.set(final, { matchId: final, slug: "calm-iron-owl", status: "live", mapId: "aim_usp", score: { A: 0, B: 1 }, maps })
    await h.mapResult({ matchId: final, mapNumber: 1, winnerTeam: "B" })
    m = await get()
    expect(m("r3m0")).toMatchObject({ status: "live", bestOf: 3, score: { a: 0, b: 1 }, room: "calm-iron-owl" })
    expect(m("r3m0").maps?.map((x) => [x.status, x.score, x.winner])).toEqual([
      ["done", { a: 10, b: 13 }, "b"],
      ["live", { a: 3, b: 1 }, null],
    ])

    const detail = (await h.app.inject({ url: `/tournaments/${t.id}` })).json().tournament
    expect(detail.bracket.matches.find((x: { id: string }) => x.id === "r3m0").score).toEqual({ a: 0, b: 1 })
    expect(lookups.every((ids) => new Set(ids).size === ids.length)).toBe(true)
  })

  it("ignores results for unknown or repeated games", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    const gid = liveGame("r1m1").matchId
    await h.result({ matchId: "11111111-1111-4111-8111-111111111111", outcome: "completed", winnerTeam: "A", score: {} })
    await win("r1m1", "A")
    const snap = JSON.stringify(bracket())
    await h.result({ matchId: gid, outcome: "completed", winnerTeam: "B", score: {} })
    expect(JSON.stringify(bracket())).toBe(snap)
  })

  it("eliminates both sides when both are absent", async () => {
    const t = await fiveEntrants()
    await h.startNow(t.startsAt)
    await h.result({
      matchId: liveGame("r1m1").matchId,
      outcome: "abandoned",
      reason: "no_show",
      missingSteamIds: ["p4", "p5"],
    })
    expect(bm("r1m1").resolution).toBe("double_forfeit")
    expect(bm("r2m0").resolution).toBe("walkover")
    expect(bm("r2m0").winner).toBe(entryOf("p1"))
  })

  it("replays a cancelled game and retries when no server is free", async () => {
    const t = await fiveEntrants()
    h.failStart.value = true
    await h.startNow(t.startsAt)
    expect(h.started).toHaveLength(0)
    expect(bm("r1m1").status).toBe("ready")
    expect(h.store.brackets.get(t.id)?.provisionAttempts.r1m1).toBe(1)

    h.failStart.value = false
    await h.tick()
    expect(bm("r1m1").status).toBe("live")
    const first = liveGame("r1m1").matchId

    await h.result({ matchId: first, outcome: "cancelled", reason: "server_crashed" })
    expect(liveGame("r1m1").matchId).not.toBe(first)
    expect(bm("r1m1").status).toBe("live")
    expect(liveGame("r1m1").source.gameNumber).toBe(1)
  })

  it("drops entries that lost Verified before the start", async () => {
    const t = await fiveEntrants()
    h.trust.p5 = "new"
    await h.startNow(t.startsAt)
    expect(h.store.entries.size).toBe(4)
    expect(bracket()?.size).toBe(4)
  })

  it("requests servers outside the row lock, four at a time", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const t = h.only()
    for (let i = 1; i <= 16; i++) verify(`p${i}`)
    for (let i = 1; i <= 16; i++) await h.enter(t.id, `p${i}`)
    let inFlight = 0
    let peak = 0
    h.onStart.fn = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      // Deadlocks if startMatch runs while the tournament row is locked.
      await h.store.locked(t.id, async () => undefined)
      expect(bm(`r1m0`).status === "provisioning" || bm("r1m0").status === "live").toBe(true)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    }
    await h.startNow(t.startsAt)
    expect(h.started).toHaveLength(8)
    expect(peak).toBe(4)
    expect(bracket()?.matches.filter((m) => m.status === "live")).toHaveLength(8)
  })

  it("releases a stale provisioning claim", async () => {
    const t = await fiveEntrants()
    h.failStart.value = true
    await h.startNow(t.startsAt)
    // Simulate a process that died after claiming r1m1.
    const stored = h.store.brackets.get(t.id)!
    stored.bracket.matches.find((m) => m.id === "r1m1")!.status = "provisioning"
    stored.provisioningAt.r1m1 = h.clock.now.getTime()
    h.failStart.value = false
    await h.tick()
    expect(bm("r1m1").status).toBe("provisioning")
    h.clock.now = new Date(h.clock.now.getTime() + 6 * 60_000)
    await h.tick()
    expect(bm("r1m1").status).toBe("live")
  })
})

describe("bracket endpoint", () => {
  it("serves the bracket with a version ETag and 304s", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const t = h.only()
    verify("p1", "p2")
    await h.enter(t.id, "p1")
    await h.enter(t.id, "p2")
    const before = await h.app.inject({ url: `/tournaments/${t.id}/bracket` })
    expect(before.statusCode).toBe(200)
    expect(before.headers.etag).toBe('"0"')
    expect(before.json()).toEqual({ tournamentId: t.id, version: 0, bracket: null })

    await h.startNow(t.startsAt)
    const v = h.only().bracketVersion
    expect(v).toBeGreaterThan(0)
    const detail = await h.app.inject({ url: `/tournaments/${t.id}` })
    expect(detail.json().tournament.bracketVersion).toBe(v)

    const res = await h.app.inject({ url: `/tournaments/${t.id}/bracket` })
    expect(res.headers.etag).toBe(`"${v}"`)
    expect(res.json().bracket.matches).toHaveLength(1)
    const same = await h.app.inject({
      url: `/tournaments/${t.id}/bracket`,
      headers: { "if-none-match": `W/"${v}"` },
    })
    expect(same.statusCode).toBe(304)
    expect(same.body).toBe("")

    await win("r1m0", "A")
    const moved = await h.app.inject({
      url: `/tournaments/${t.id}/bracket`,
      headers: { "if-none-match": `"${v}"` },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().version).toBeGreaterThan(v)
    const last = h.emitted.at(-1)?.payload
    expect(last?.bracketVersion).toBe(moved.json().version)
    expect((await h.app.inject({ url: "/tournaments/nope/bracket" })).statusCode).toBe(404)
  })

  it("sends entry changes to subscribers only", async () => {
    h = await harness([cup("daily-aim1v1")])
    await h.tick()
    const t = h.only()
    verify("p1")
    await h.enter(t.id, "p1")
    expect(h.emitted.at(-1)?.payload.kind).toBe("entries_changed")
    expect(h.audiences.at(-1)).toEqual({ kind: "tournament", tournamentId: t.id })
    expect(h.audiences[0]).toEqual({ kind: "broadcast" })
  })
})
