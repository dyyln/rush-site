import { describe, expect, it } from "vitest"
import { applyRoomEvent, connectDeadlineOf, mergeRoomDetail, roomFromDetail, roomPath, roomStage, type RoomEvent, type RoomState } from "./room.js"
import type { MatchDetail } from "./schemas/match.js"
import type { VetoState } from "./schemas/veto.js"

const ID = "9d4f1c2a-7b3e-4a5d-8c6f-1e2d3c4b5a69"
const OTHER = "11111111-2222-4333-8444-555555555555"
const A = "76561198000000001"
const B = "76561198000000002"

function detail(patch: Partial<MatchDetail> = {}): MatchDetail {
  return {
    id: ID,
    slug: "brave-amber-falcon",
    mode: "aim1v1",
    mapId: null,
    status: "accepting",
    driver: null,
    startedAt: null,
    endedAt: null,
    teams: [
      { name: "A", score: 0, players: [] },
      { name: "B", score: 0, players: [] },
    ],
    rounds: [],
    ...patch,
  }
}

function veto(done: boolean): VetoState {
  return {
    pool: ["aim_map", "aim_usp"],
    teams: [
      { id: "A", steamIds: [A] },
      { id: "B", steamIds: [B] },
    ],
    steps: [{ action: "ban", team: 0 }],
    stepIndex: done ? 1 : 0,
    available: done ? ["aim_usp"] : ["aim_map", "aim_usp"],
    votes: {},
    history: [],
    done,
    maps: done ? ["aim_usp"] : [],
  }
}

const found = (accepted: number): RoomEvent => ({
  type: "match_found",
  payload: { matchId: ID, slug: "brave-amber-falcon", mode: "aim1v1", acceptDeadline: 1000, acceptWindowSec: 20, accepted, required: 2 },
})
const server: RoomEvent = {
  type: "server_ready",
  payload: { matchId: ID, ip: "1.2.3.4", port: 27015, password: "pw", connect: "connect 1.2.3.4:27015; password pw", mapId: "aim_usp" },
}

function run(s: RoomState, ...events: RoomEvent[]): RoomState {
  return events.reduce(applyRoomEvent, s)
}

describe("roomFromDetail", () => {
  it("maps each status to a stage", () => {
    expect(roomStage(roomFromDetail(detail({ accept: { deadline: 1, windowSec: 20, accepted: 1, required: 2, responded: true } })))).toBe("accept")
    expect(roomStage(roomFromDetail(detail({ accept: { deadline: 1, windowSec: 20, accepted: 2, required: 2, responded: true } })))).toBe("allocating")
    expect(roomStage(roomFromDetail(detail({ status: "veto", veto: { state: veto(false), stepDeadline: 5 } })))).toBe("veto")
    expect(roomStage(roomFromDetail(detail({ status: "starting" })))).toBe("allocating")
    // Ready without connect info is a spectator view
    expect(roomStage(roomFromDetail(detail({ status: "ready" })))).toBe("allocating")
    const connect = { ip: "1.2.3.4", port: 27015, password: "pw", connect: "connect 1.2.3.4:27015" }
    expect(roomStage(roomFromDetail(detail({ status: "ready", connect, mapId: "aim_usp" })))).toBe("connect")
    expect(roomStage(roomFromDetail(detail({ status: "live" })))).toBe("live")
    expect(roomStage(roomFromDetail(detail({ status: "finished" })))).toBe("result")
    expect(roomStage(roomFromDetail(detail({ status: "abandoned" })))).toBe("result")
    expect(roomStage(roomFromDetail(detail({ status: "cancelled" })))).toBe("cancelled")
  })

  it("keeps connect info with the map and the live series map", () => {
    const s = roomFromDetail(
      detail({
        status: "live",
        mapId: "aim_usp",
        bestOf: 3,
        connect: { ip: "1.2.3.4", port: 27015, password: "pw", connect: "c" },
        maps: [
          { mapNumber: 1, mapId: "aim_usp", status: "done", winnerTeam: "A", score: { A: 13, B: 9 }, players: [] },
          { mapNumber: 2, mapId: "aim_map", status: "live", winnerTeam: null, score: { A: 3, B: 4 } },
          { mapNumber: 3, mapId: "awp_india", status: "upcoming", winnerTeam: null, score: { A: 0, B: 0 } },
        ],
      }),
    )
    expect(s.server).toEqual({ ip: "1.2.3.4", port: 27015, password: "pw", connect: "c", mapId: "aim_usp" })
    expect(s.liveMap).toBe(2)
    expect(s.maps[0]).not.toHaveProperty("players")
  })
})

describe("applyRoomEvent", () => {
  it("walks a queue match from accept to result", () => {
    let s = roomFromDetail(detail())
    s = run(s, found(0), { type: "responded", payload: { matchId: ID } }, found(1))
    expect(roomStage(s)).toBe("accept")
    expect(s.accept).toMatchObject({ accepted: 1, required: 2, responded: true })
    s = run(s, found(2))
    expect(roomStage(s)).toBe("allocating")
    s = run(s, { type: "veto_state", payload: { matchId: ID, mode: "aim1v1", state: veto(false), stepDeadline: 5 } })
    expect(roomStage(s)).toBe("veto")
    s = run(s, { type: "veto_state", payload: { matchId: ID, mode: "aim1v1", state: veto(true), stepDeadline: null } })
    expect(s.status).toBe("allocating")
    s = run(s, server)
    expect(roomStage(s)).toBe("connect")
    s = run(s, { type: "match_update", payload: { matchId: ID, status: "ready", teams: [], connected: 1, expected: 2 } })
    expect(s.warmup).toEqual({ connected: 1, expected: 2 })
    s = run(s, { type: "match_update", payload: { matchId: ID, status: "live", teams: [{ name: "A", score: 1 }, { name: "B", score: 0 }] } })
    expect(roomStage(s)).toBe("live")
    expect(s.server?.connect).toContain("1.2.3.4")
    s = run(s, {
      type: "match_result",
      payload: { matchId: ID, mode: "aim1v1", status: "completed", winnerTeam: "A", score: { A: 13, B: 7 }, ratingChanges: [] },
    })
    expect(roomStage(s)).toBe("result")
    expect(s.scores).toEqual([
      { name: "A", score: 13 },
      { name: "B", score: 7 },
    ])
  })

  it("ignores late messages from earlier steps and other matches", () => {
    let s = roomFromDetail(detail({ status: "live" }))
    s = run(
      s,
      found(1),
      { type: "veto_state", payload: { matchId: ID, mode: "aim1v1", state: veto(false), stepDeadline: 5 } },
      { type: "match_update", payload: { matchId: ID, status: "ready", teams: [] } },
      { type: "match_cancelled", payload: { matchId: OTHER, reason: "x" } },
    )
    expect(s.status).toBe("live")
    expect(s.accept).toBeNull()
    expect(s.veto).toBeNull()
  })

  it("shows a cancel with its reason and lets the final status correct it", () => {
    let s = roomFromDetail(detail({ status: "ready" }))
    s = run(s, { type: "match_cancelled", payload: { matchId: ID, reason: "accept_declined" } })
    expect(roomStage(s)).toBe("cancelled")
    expect(s.cancelReason).toBe("accept_declined")
    s = run(s, server)
    expect(roomStage(s)).toBe("cancelled")
    s = run(s, { type: "match_update", payload: { matchId: ID, status: "abandoned", teams: [] } })
    expect(roomStage(s)).toBe("result")
  })

  it("moves the live map highlight in a series", () => {
    let s = roomFromDetail(detail({ status: "live", bestOf: 3 }))
    s = run(s, {
      type: "match_update",
      payload: {
        matchId: ID,
        status: "live",
        teams: [{ name: "A", score: 1 }, { name: "B", score: 0 }],
        mapNumber: 2,
        maps: [
          { mapNumber: 1, mapId: "aim_usp", status: "done", winnerTeam: "A", score: { A: 13, B: 11 } },
          { mapNumber: 2, mapId: "aim_map", status: "live", winnerTeam: null, score: { A: 0, B: 0 } },
        ],
      },
    })
    expect(s.liveMap).toBe(2)
    expect(s.maps).toHaveLength(2)
  })
})

describe("mergeRoomDetail", () => {
  it("takes a newer snapshot after a reconnect and keeps what only the socket knew", () => {
    let s = run(roomFromDetail(detail()), found(1), { type: "responded", payload: { matchId: ID } })
    s = mergeRoomDetail(s, detail({ accept: { deadline: 1000, windowSec: 20, accepted: 1, required: 2, responded: false } }))
    expect(s.accept?.responded).toBe(true)
    s = mergeRoomDetail(s, detail({ status: "live", teams: [{ name: "A", score: 4, players: [] }, { name: "B", score: 2, players: [] }] }))
    expect(roomStage(s)).toBe("live")
    expect(s.scores[0]!.score).toBe(4)
  })

  it("keeps the live view when the snapshot is older", () => {
    const s = run(roomFromDetail(detail({ status: "veto" })), server)
    expect(mergeRoomDetail(s, detail({ status: "veto" }))).toBe(s)
  })

  it("keeps connect info a refetch left out while the match runs", () => {
    const s = run(roomFromDetail(detail({ status: "starting" })), server)
    expect(mergeRoomDetail(s, detail({ status: "ready" })).server?.ip).toBe("1.2.3.4")
    expect(mergeRoomDetail(s, detail({ status: "finished" })).server).toBeNull()
  })
})

describe("roomPath", () => {
  it("prefers the room id", () => {
    expect(roomPath({ matchId: ID, slug: "brave-amber-falcon" })).toBe("/matches/brave-amber-falcon")
    expect(roomPath({ matchId: ID })).toBe(`/matches/${ID}`)
    expect(roomPath({ id: ID, slug: null })).toBe(`/matches/${ID}`)
  })
})

describe("warm-up details", () => {
  it("keeps who accepted, who is missing and the connect deadline", () => {
    let s = roomFromDetail(detail())
    s = run(s, { type: "match_found", payload: { ...(found(1) as Extract<RoomEvent, { type: "match_found" }>).payload, acceptedSteamIds: [A] } })
    expect(s.accept?.acceptedSteamIds).toEqual([A])
    s = run(s, { type: "server_ready", payload: { ...(server as Extract<RoomEvent, { type: "server_ready" }>).payload, connectDeadline: 9000 } })
    expect(connectDeadlineOf(s)).toBe(9000)
    s = run(s, { type: "match_update", payload: { matchId: ID, status: "ready", teams: [], connected: 1, expected: 2, missingSteamIds: [B] } })
    expect(s.warmup?.missingSteamIds).toEqual([B])
    expect(connectDeadlineOf(s)).toBe(9000)
  })

  it("reads the deadline from the REST warm-up after a reload", () => {
    const s = roomFromDetail(
      detail({ status: "ready", connect: { ip: "1.2.3.4", port: 1, password: "p", connect: "c" }, warmup: { connected: 0, expected: 2, connectDeadline: 5000, missingSteamIds: [A, B] } }),
    )
    expect(connectDeadlineOf(s)).toBe(5000)
    expect(s.warmup?.missingSteamIds).toEqual([A, B])
  })
})
