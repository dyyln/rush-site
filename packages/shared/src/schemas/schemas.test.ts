import { describe, expect, it } from "vitest"
import {
  MatchDetailResponseSchema,
  MatchDetailSchema,
  MatchEventSchema,
  MatchRoundSchema,
  MatchWebhookBodySchema,
  StartServerRequestSchema,
  trustAtLeast,
  VetoStateSchema,
} from "./index.js"
import { ClientMessageSchema, ServerMessageSchema, serverMessage } from "../ws.js"
import { CreateCupSchema } from "./cups.js"
import {
  ALL_RUSH_ROOMS,
  allowedModesForParty,
  findRushRoom,
  isRushMode,
  isTestMode,
  MODE_CONFIGS,
  RANKED_MODES,
  RUSH_ROOMS,
  RUSH_RULES,
  unresolvedConfig,
} from "../config/modes.js"
import { tierForRating, TIERS } from "../config/tiers.js"
import { cooldownSeconds, maxRatingDiffAfter, canMixBuckets } from "../config/queue.js"
import { createVeto } from "../veto/bo3.js"

const SID = "76561198000000001"
const SID2 = "76561198000000002"
const MID = "3b241101-e2bb-4255-8caf-4136c566a962"

describe("schemas", () => {
  it("parses a StartServerRequest", () => {
    const req = {
      matchId: MID,
      mode: "rush3v3",
      map: { id: "x", displayName: "X" },
      gslt: "token",
      password: "pw",
      allowedSteamIds: [SID, SID2],
      teams: [
        { name: "a", steamIds: [SID] },
        { name: "b", steamIds: [SID2] },
      ],
      webhookUrl: "http://api:3000/webhooks/match/" + MID,
      webhookSecret: "0123456789abcdef",
      demoUpload: { bucket: "demos", key: "k", presignedPutUrl: "https://s3.example/put" },
      cs2: { ...MODE_CONFIGS.rush3v3.cs2, mapName: "rush_001" },
    }
    expect(StartServerRequestSchema.parse(req)).toEqual(req)
    expect(() => StartServerRequestSchema.parse({ ...req, mode: "wingman" })).toThrow()
    const withArgs = { ...req, cs2: { ...req.cs2, extraArgs: ["+tv_enable", "1"] } }
    expect(StartServerRequestSchema.parse(withArgs).cs2).toEqual(withArgs.cs2)
    const { cs2: _cs2, ...noCs2 } = req
    expect(() => StartServerRequestSchema.parse(noCs2)).toThrow()
    expect(() => StartServerRequestSchema.parse({ ...req, cs2: MODE_CONFIGS.aim1v1.cs2 })).toThrow()
    expect(() => StartServerRequestSchema.parse({ ...req, cs2: { ...req.cs2, workshopId: "123" } })).toThrow()
    expect(() => StartServerRequestSchema.parse({ ...req, cs2: { ...req.cs2, execCfg: "../x.cfg" } })).toThrow()
    expect(() => StartServerRequestSchema.parse({ ...req, cs2: { ...req.cs2, extraArgs: ["+map de_dust2"] } })).toThrow()
  })

  it("parses match events", () => {
    expect(MatchEventSchema.parse({ type: "server_ready" })).toEqual({ type: "server_ready" })
    const end = {
      type: "match_end",
      winnerTeam: "a",
      score: { a: 16, b: 10 },
      players: [{ steamId: SID, kills: 20, deaths: 10, headshots: 8, damage: 2500 }],
      demoUploaded: true,
    }
    expect(MatchWebhookBodySchema.parse({ event: end }).event).toEqual(end)
    expect(() => MatchEventSchema.parse({ type: "player_connected" })).toThrow()
    const round = { type: "round_end", round: 3, winnerTeam: "draw", score: { a: 1, b: 1 }, arena: "203" }
    expect(MatchEventSchema.parse(round)).toEqual(round)
    const { arena: _arena, ...noArena } = round
    expect(MatchEventSchema.parse(noArena)).toEqual(noArena)
    expect(MatchEventSchema.parse({ type: "demo_uploaded", ok: true, bytes: 1024 })).toEqual({
      type: "demo_uploaded",
      ok: true,
      bytes: 1024,
    })
    expect(MatchEventSchema.parse({ type: "demo_uploaded", ok: false, error: "timeout" }).type).toBe("demo_uploaded")
    expect(() => MatchEventSchema.parse({ type: "demo_uploaded" })).toThrow()
  })

  it("parses WS messages", () => {
    const m = serverMessage("queue_status", {
      state: "queued",
      partyId: null,
      modes: [
        { mode: "aim1v1", queuedAt: 1, waitSec: 12, ratingWindow: 100 },
        { mode: "rush3v3", queuedAt: 1, waitSec: 12, estimatedSec: 60, ratingWindow: null },
      ],
      cooldownUntil: null,
    })
    expect(ServerMessageSchema.parse(m)).toEqual(m)
    const veto = serverMessage("veto_state", {
      matchId: MID,
      mode: "aim1v1",
      state: createVeto({
        pool: ["a", "b", "c", "d", "e", "f"],
        teams: [
          { id: "a", steamIds: [SID] },
          { id: "b", steamIds: [SID2] },
        ],
      }),
      stepDeadline: 123,
    })
    expect(ServerMessageSchema.parse(veto)).toEqual(veto)
    const join = (payload: unknown) => ClientMessageSchema.parse({ type: "queue_join", payload, ts: 1 })
    expect(join({ modes: ["rush3v3", "aim2v2"] }).type).toBe("queue_join")
    expect(() => join({ modes: [] })).toThrow()
    expect(() => join({ modes: ["aim1v1", "aim1v1"] })).toThrow()
    expect(() => join({ modes: ["x"] })).toThrow()
    const leave = (payload: unknown) => ClientMessageSchema.parse({ type: "queue_leave", payload, ts: 1 })
    expect(leave({}).type).toBe("queue_leave")
    expect(leave({ modes: ["aim1v1"] }).type).toBe("queue_leave")
    expect(() => leave({ modes: [] })).toThrow()
    expect(() =>
      ServerMessageSchema.parse(
        serverMessage("queue_status", {
          state: "queued",
          partyId: null,
          modes: [
            { mode: "aim1v1", queuedAt: 1, waitSec: 0, ratingWindow: 100 },
            { mode: "aim1v1", queuedAt: 1, waitSec: 0, ratingWindow: 100 },
          ],
          cooldownUntil: null,
        }),
      ),
    ).toThrow()
  })

  it("parses server_ready with explicit connect parts", () => {
    const ready = serverMessage("server_ready", {
      matchId: MID,
      ip: "203.0.113.5",
      port: 27015,
      password: "pw",
      connect: "connect 203.0.113.5:27015; password pw",
      mapId: "rush_001",
    })
    expect(ServerMessageSchema.parse(ready)).toEqual(ready)
    const { password: _pw, ...noPassword } = ready.payload
    expect(() => ServerMessageSchema.parse({ ...ready, payload: noPassword })).toThrow()
  })

  it("parses mode_stats and queue status counts", () => {
    const stats = serverMessage("mode_stats", {
      modes: [
        { mode: "aim1v1", playersInQueue: 4, matchesInProgress: 2 },
        { mode: "rush3v3", playersInQueue: 0, matchesInProgress: 0 },
      ],
    })
    expect(ServerMessageSchema.parse(stats)).toEqual(stats)
    expect(() =>
      ServerMessageSchema.parse({ ...stats, payload: { modes: [{ mode: "aim1v1", playersInQueue: 1 }] } }),
    ).toThrow()
    const status = serverMessage("queue_status", {
      state: "queued",
      partyId: null,
      modes: [{ mode: "aim2v2", queuedAt: 1, waitSec: 5, ratingWindow: 100, matchesInProgress: 3 }],
      cooldownUntil: null,
    })
    expect(ServerMessageSchema.parse(status)).toEqual(status)
  })

  it("parses admin_event", () => {
    const ev = serverMessage("admin_event", { kind: "host", payload: { hostId: "h1", free: 3 } })
    expect(ServerMessageSchema.parse(ev)).toEqual(ev)
    expect(() => ServerMessageSchema.parse({ ...ev, payload: { kind: "nope", payload: null } })).toThrow()
  })

  it("parses match_cancelled and error", () => {
    const c = serverMessage("match_cancelled", { matchId: MID, reason: "accept_timeout" })
    expect(ServerMessageSchema.parse(c)).toEqual(c)
    const e = serverMessage("error", { code: "queue_party_too_large", message: "Party too large" })
    expect(ServerMessageSchema.parse(e)).toEqual(e)
    const eRef = serverMessage("error", { code: "x", message: "y", ref: MID })
    expect(ServerMessageSchema.parse(eRef)).toEqual(eRef)
    expect(() => ServerMessageSchema.parse({ ...e, payload: { code: "x" } })).toThrow()
    expect(() => ServerMessageSchema.parse({ ...c, payload: { matchId: "bad", reason: "r" } })).toThrow()
  })

  it("parses match detail and live match messages", () => {
    const round = { round: 1, winnerTeam: "a", score: { a: 1, b: 0 }, arena: "101", endedAt: "2026-09-23T12:00:00Z" }
    const detail = {
      match: {
        id: MID,
        mode: "rush3v3",
        mapId: "rush_001",
        status: "live",
        driver: "hetzner",
        startedAt: "2026-09-23T11:58:00Z",
        endedAt: null,
        teams: [
          {
            name: "a",
            score: 1,
            players: [
              {
                steamId: SID,
                displayName: "p1",
                avatarUrl: null,
                tier: "silver",
                rating: 1500,
                kills: 2,
                deaths: 0,
                headshots: 1,
                damage: 200,
              },
            ],
          },
          { name: "b", score: 0, players: [] },
        ],
        rounds: [round],
        tournament: { id: MID, name: "Daily", bracketMatchId: "r1m0", bestOf: 3, gameNumber: 1 },
        connect: { ip: "203.0.113.5", port: 27015, password: "pw", connect: "connect 203.0.113.5:27015; password pw" },
      },
    }
    expect(MatchDetailResponseSchema.parse(detail)).toEqual(detail)
    expect(() => MatchDetailSchema.parse({ ...detail.match, status: "weird" })).toThrow()
    const { connect: _connect, ...publicView } = detail.match
    expect(MatchDetailSchema.parse(publicView)).toEqual(publicView)
    expect(() =>
      MatchDetailSchema.parse({ ...detail.match, tournament: { ...detail.match.tournament, bracketMatchId: "" } }),
    ).toThrow()
    expect(MatchRoundSchema.parse({ ...round, winnerTeam: "draw" }).winnerTeam).toBe("draw")

    const update = serverMessage("match_update", {
      matchId: MID,
      status: "live",
      teams: [
        { name: "a", score: 1 },
        { name: "b", score: 0 },
      ],
      lastRound: round,
    })
    expect(ServerMessageSchema.parse(update)).toEqual(update)
    const bare = serverMessage("match_update", { matchId: MID, status: "cancelled", teams: [] })
    expect(ServerMessageSchema.parse(bare)).toEqual(bare)

    expect(ClientMessageSchema.parse({ type: "subscribe_match", payload: { matchId: MID }, ts: 1 }).type).toBe(
      "subscribe_match",
    )
    expect(ClientMessageSchema.parse({ type: "unsubscribe_match", payload: { matchId: MID }, ts: 1 }).type).toBe(
      "unsubscribe_match",
    )
    expect(() => ClientMessageSchema.parse({ type: "subscribe_match", payload: {}, ts: 1 })).toThrow()
  })

  it("parses tournament subscriptions", () => {
    for (const type of ["subscribe_tournament", "unsubscribe_tournament"] as const) {
      expect(ClientMessageSchema.parse({ type, payload: { tournamentId: MID }, ts: 1 }).type).toBe(type)
    }
    expect(() =>
      ClientMessageSchema.parse({ type: "subscribe_tournament", payload: { tournamentId: "x" }, ts: 1 }),
    ).toThrow()
  })

  it("veto state round trips", () => {
    const s = createVeto({
      pool: ["a", "b", "c", "d", "e"],
      teams: [
        { id: "a", steamIds: [SID] },
        { id: "b", steamIds: [SID2] },
      ],
    })
    expect(VetoStateSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it("orders trust levels", () => {
    expect(trustAtLeast("trusted", "verified")).toBe(true)
    expect(trustAtLeast("new", "verified")).toBe(false)
  })
})

describe("config", () => {
  it("has the three ranked modes and the Rush test mode with expected pools", () => {
    expect(Object.keys(MODE_CONFIGS)).toEqual(["aim1v1", "aim2v2", "rush3v3", "rush1v1"])
    expect(RANKED_MODES).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    expect(isTestMode("rush1v1")).toBe(true)
    expect(isTestMode("rush3v3")).toBe(false)
    expect(isRushMode("rush1v1")).toBe(true)
    expect(isRushMode("aim1v1")).toBe(false)
    expect(MODE_CONFIGS.rush1v1).toMatchObject({ teamSize: 1, vetoFormat: "none", winCondition: "valve_rush" })
    expect(MODE_CONFIGS.rush1v1.maps).toEqual(MODE_CONFIGS.rush3v3.maps)
    expect(MODE_CONFIGS.rush1v1.cs2).toEqual({ gameType: 0, gameMode: 6, execCfg: "rushsite_rush1v1.cfg" })
    expect(MODE_CONFIGS.aim1v1.maps).toHaveLength(6)
    expect(MODE_CONFIGS.rush3v3.maps).toEqual([{ id: "rush_001", displayName: "Complex", mapName: "rush_001" }])
    expect(MODE_CONFIGS.rush3v3.cs2).toEqual({ gameType: 0, gameMode: 6, execCfg: "rushsite_rush3v3.cfg" })
    expect(MODE_CONFIGS.rush3v3.winCondition).toBe("valve_rush")
    expect(unresolvedConfig("rush3v3")).toEqual([])
    expect(MODE_CONFIGS.aim1v1.vetoFormat).toBe("bo1-ban")
    expect(MODE_CONFIGS.aim2v2.vetoFormat).toBe("bo1-ban")
    expect(MODE_CONFIGS.rush3v3.vetoFormat).toBe("none")
  })

  it("keeps test modes out of cups", () => {
    const cup = { name: "Test Cup", startsAt: "2026-09-25T18:00:00Z", maxEntrants: 8, minTrust: "verified" }
    expect(CreateCupSchema.safeParse({ ...cup, mode: "rush3v3" }).success).toBe(true)
    expect(CreateCupSchema.safeParse({ ...cup, mode: "rush1v1" }).success).toBe(false)
  })

  it("allows modes by party size", () => {
    expect(allowedModesForParty(1)).toEqual(["aim1v1", "aim2v2", "rush3v3", "rush1v1"])
    expect(allowedModesForParty(2)).toEqual(["aim2v2", "rush3v3"])
    expect(allowedModesForParty(3)).toEqual(["rush3v3"])
    expect(allowedModesForParty(4)).toEqual([])
    expect(allowedModesForParty(0)).toEqual([])
  })

  it("lists the Rush rooms and rules", () => {
    expect(RUSH_ROOMS.startRooms.map((r) => r.id)).toEqual([101, 102, 103, 104])
    expect(RUSH_ROOMS.midRooms.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => 201 + i))
    expect(RUSH_ROOMS.castles.t.id).toBe(401)
    expect(RUSH_ROOMS.castles.ct.id).toBe(301)
    expect(RUSH_ROOMS.decider).toEqual({ id: "convoy", displayName: "Convoy" })
    expect(new Set(ALL_RUSH_ROOMS.map((r) => r.id)).size).toBe(19)
    expect(findRushRoom(203)?.displayName).toBe("Trainyard")
    expect(RUSH_RULES).toMatchObject({ maxRounds: 15, roundsToWin: 8, midRoundTimeSec: 40.5, castleRoundTimeSec: 60.5 })
  })

  it("bands tiers", () => {
    expect(tierForRating(0).id).toBe("iron")
    expect(tierForRating(999).id).toBe("iron")
    expect(tierForRating(1000).id).toBe("bronze")
    expect(tierForRating(1299).id).toBe("bronze")
    expect(tierForRating(1300).id).toBe("silver")
    expect(tierForRating(1500).id).toBe("silver")
    expect(tierForRating(1899).id).toBe("gold")
    expect(tierForRating(2199).id).toBe("platinum")
    expect(tierForRating(2200).id).toBe("elite")
    expect(tierForRating(3000).id).toBe("elite")
    expect(TIERS).toHaveLength(6)
  })

  it("widens the rating range and escalates cooldowns", () => {
    expect(maxRatingDiffAfter(0)).toBe(100)
    expect(maxRatingDiffAfter(45)).toBe(200)
    expect(maxRatingDiffAfter(10_000)).toBeNull()
    expect(canMixBuckets("rush3v3", 10)).toBe(false)
    expect(canMixBuckets("rush3v3", 90)).toBe(true)
    expect(cooldownSeconds("decline", 1)).toBe(60)
    expect(cooldownSeconds("abandon", 2)).toBe(3600)
    expect(cooldownSeconds("abandon", 99)).toBe(7 * 24 * 3600)
  })
})
