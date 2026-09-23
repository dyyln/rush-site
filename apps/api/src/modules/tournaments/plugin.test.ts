import { ServerMessageSchema } from "@rushsite/shared"
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { type CupDefinition, DEFAULT_CUPS } from "./config.js"
import tournamentsPlugin from "./index.js"
import { MemoryTournamentStore } from "./memory-store.js"
import type { TournamentService } from "./service.js"
import type {
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
  let handler: MatchResultHandler | undefined
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
      if (failStart.value) throw new Error("no free slots")
      const matchId = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`
      started.push({ ...p, matchId })
      return { matchId }
    },
    onMatchResult: (h) => {
      handler = h
    },
    emit: (m) => emitted.push(m),
    authenticate: async (req) => (req.headers["x-steam-id"] as string | undefined) ?? null,
    getTrustLevels: async (ids) => Object.fromEntries(ids.map((id) => [id, trust[id] ?? "new"])),
    getRatings: async (ids) => Object.fromEntries(ids.map((id) => [id, ratings[id] ?? 1500])),
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
    tick: () => (service as TournamentService).tick(),
    result: (r: MatchResult) => (handler as MatchResultHandler)(r),
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
      players: [{ steamId: "p1", displayName: "N-p1", avatarUrl: "https://a/p1" }],
    })
    expect((await h.enter(id, "p1")).json().error).toBe("already_entered")
    const detail = await h.app.inject({ url: `/tournaments/${id}`, headers: { "x-steam-id": "p1" } })
    expect(detail.json().tournament.myEntryId).toBe(ok.json().entry.id)
    expect(detail.json().tournament.entries[0].name).toBe("N-p1")
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
    expect(h.emitted.some((e) => e.payload.kind === "started" && e.payload.bracket)).toBe(true)
    const seeds = [...h.store.entries.values()].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    expect(seeds.map((e) => e.captainSteamId)).toEqual(["p1", "p2", "p3", "p4", "p5"])
    const shown = (await h.app.inject({ url: `/tournaments/${t.id}` })).json().tournament.entries
    // p5 has no profile and falls back to the SteamID.
    expect(shown.find((e: { captainSteamId: string }) => e.captainSteamId === "p5").name).toBe("p5")

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
})
