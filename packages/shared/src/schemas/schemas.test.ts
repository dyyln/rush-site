import { describe, expect, it } from "vitest"
import {
  MatchEventSchema,
  MatchWebhookBodySchema,
  StartServerRequestSchema,
  trustAtLeast,
  VetoStateSchema,
} from "./index.js"
import { ClientMessageSchema, ServerMessageSchema, serverMessage } from "../ws.js"
import { ALL_RUSH_ROOMS, findRushRoom, MODE_CONFIGS, RUSH_ROOMS, RUSH_RULES, unresolvedConfig } from "../config/modes.js"
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
    }
    expect(StartServerRequestSchema.parse(req)).toEqual(req)
    expect(() => StartServerRequestSchema.parse({ ...req, mode: "wingman" })).toThrow()
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
  })

  it("parses WS messages", () => {
    const m = serverMessage("queue_status", {
      state: "queued",
      mode: "aim1v1",
      partyId: null,
      queuedAt: 1,
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
    expect(ClientMessageSchema.parse({ type: "queue_join", payload: { mode: "rush3v3" }, ts: 1 }).type).toBe("queue_join")
    expect(() => ClientMessageSchema.parse({ type: "queue_join", payload: { mode: "x" }, ts: 1 })).toThrow()
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
  it("has the three modes with expected pools", () => {
    expect(Object.keys(MODE_CONFIGS)).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    expect(MODE_CONFIGS.aim1v1.maps).toHaveLength(6)
    expect(MODE_CONFIGS.rush3v3.maps).toEqual([{ id: "rush_001", displayName: "Complex", mapName: "rush_001" }])
    expect(MODE_CONFIGS.rush3v3.cs2).toEqual({ gameType: 0, gameMode: 6, execCfg: "gamemode_rush.cfg" })
    expect(MODE_CONFIGS.rush3v3.winCondition).toBe("valve_rush")
    expect(unresolvedConfig("rush3v3")).toEqual([])
    expect(MODE_CONFIGS.aim1v1.vetoFormat).toBe("bo1-ban")
    expect(MODE_CONFIGS.aim2v2.vetoFormat).toBe("bo1-ban")
    expect(MODE_CONFIGS.rush3v3.vetoFormat).toBe("none")
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
