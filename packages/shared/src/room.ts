import type { Mode } from "./schemas/mode.js"
import type { MatchAcceptView, MatchDetail, MatchMap, MatchStatus, MatchVetoView } from "./schemas/match.js"
import type {
  MatchCancelledPayload,
  MatchFoundPayload,
  MatchResultPayload,
  MatchUpdatePayload,
  ServerReadyPayload,
  VetoStatePayload,
} from "./ws.js"

// What the match room shows. REST gives the first snapshot and ws events move it forward
export type RoomStage = "accept" | "veto" | "allocating" | "connect" | "live" | "result" | "cancelled"

export type RoomServer = { ip: string; port: number; password: string; connect: string; mapId: string }

export type RoomMap = Omit<MatchMap, "players">

export type RoomState = {
  matchId: string
  slug: string | null
  mode: Mode
  status: MatchStatus
  accept: MatchAcceptView | null
  veto: MatchVetoView | null
  server: RoomServer | null
  warmup: { connected: number; expected: number } | null
  // Rounds on a single map, maps won in a series
  scores: { name: string; score: number }[]
  maps: RoomMap[]
  liveMap: number | null
  result: MatchResultPayload | null
  cancelReason: string | null
}

export type RoomEvent =
  | { type: "match_found"; payload: MatchFoundPayload }
  | { type: "veto_state"; payload: VetoStatePayload }
  | { type: "server_ready"; payload: ServerReadyPayload }
  | { type: "match_update"; payload: MatchUpdatePayload }
  | { type: "match_result"; payload: MatchResultPayload }
  | { type: "match_cancelled"; payload: MatchCancelledPayload }
  // The viewer answered the accept prompt from this tab
  | { type: "responded"; payload: { matchId: string } }

const RANK: Record<MatchStatus, number> = {
  accepting: 0,
  veto: 1,
  allocating: 2,
  starting: 3,
  ready: 4,
  live: 5,
  finished: 6,
  abandoned: 6,
  cancelled: 6,
}

export const isRoomOver = (s: MatchStatus): boolean => RANK[s] === 6

// Later statuses win. A late message from an earlier step never moves the room back
function advance(cur: MatchStatus, next: MatchStatus): MatchStatus {
  return RANK[next] > RANK[cur] ? next : cur
}

function liveMapOf(maps: RoomMap[]): number | null {
  return maps.find((m) => m.status === "live")?.mapNumber ?? null
}

function stripPlayers(maps: MatchMap[] | undefined): RoomMap[] {
  return (maps ?? []).map(({ players: _players, ...rest }) => rest)
}

export function roomFromDetail(d: MatchDetail): RoomState {
  const maps = stripPlayers(d.maps)
  return {
    matchId: d.id,
    slug: d.slug ?? null,
    mode: d.mode,
    status: d.status,
    accept: d.accept ?? null,
    veto: d.veto ?? null,
    server: d.connect ? { ...d.connect, mapId: d.mapId ?? "" } : null,
    warmup: d.warmup ?? null,
    scores: d.teams.map((t) => ({ name: t.name, score: t.score })),
    maps,
    liveMap: liveMapOf(maps),
    result: null,
    cancelReason: null,
  }
}

// A refetch replaces the live view unless the live view is already further along
export function mergeRoomDetail(s: RoomState, d: MatchDetail): RoomState {
  if (d.id !== s.matchId || RANK[d.status] < RANK[s.status]) return s
  const next = roomFromDetail(d)
  return {
    ...next,
    slug: next.slug ?? s.slug,
    accept: next.accept && s.accept?.responded ? { ...next.accept, responded: true } : next.accept,
    server: next.server ?? (isRoomOver(next.status) ? null : s.server),
    result: s.result,
    cancelReason: s.cancelReason,
  }
}

export function applyRoomEvent(s: RoomState, e: RoomEvent): RoomState {
  if (e.payload.matchId !== s.matchId) return s
  switch (e.type) {
    case "match_found": {
      if (RANK[s.status] > RANK.accepting) return s
      const p = e.payload
      return {
        ...s,
        slug: p.slug ?? s.slug,
        accept: {
          deadline: p.acceptDeadline,
          windowSec: p.acceptWindowSec,
          accepted: p.accepted,
          required: p.required,
          responded: s.accept?.responded ?? false,
        },
      }
    }
    case "responded":
      return s.accept ? { ...s, accept: { ...s.accept, responded: true } } : s
    case "veto_state": {
      const p = e.payload
      const status = advance(s.status, p.state.done ? "allocating" : "veto")
      if (RANK[status] > RANK.allocating) return s
      return { ...s, slug: p.slug ?? s.slug, status, veto: { state: p.state, stepDeadline: p.stepDeadline, ...(p.kind ? { kind: p.kind } : {}) } }
    }
    case "server_ready": {
      if (isRoomOver(s.status)) return s
      const { matchId: _m, slug, ...server } = e.payload
      return { ...s, slug: slug ?? s.slug, status: advance(s.status, "ready"), server }
    }
    case "match_update": {
      const p = e.payload
      // Once over only another final status may change it, for example cancelled to abandoned
      const status = isRoomOver(s.status) ? (isRoomOver(p.status) ? p.status : s.status) : advance(s.status, p.status)
      const maps = p.maps ?? s.maps
      return {
        ...s,
        status,
        scores: p.teams.length > 0 ? p.teams : s.scores,
        warmup: p.connected !== undefined && p.expected !== undefined ? { connected: p.connected, expected: p.expected } : s.warmup,
        maps,
        liveMap: p.mapNumber ?? (p.maps ? liveMapOf(maps) : s.liveMap),
      }
    }
    case "match_result": {
      const p = e.payload
      const status: MatchStatus = p.status === "completed" ? "finished" : "abandoned"
      const scores = Object.keys(p.score).length > 0 ? s.scores.map((t) => ({ name: t.name, score: p.score[t.name] ?? t.score })) : s.scores
      return { ...s, status, result: p, scores, liveMap: null }
    }
    case "match_cancelled":
      return { ...s, status: isRoomOver(s.status) ? s.status : "cancelled", cancelReason: e.payload.reason, liveMap: null }
  }
}

export function roomStage(s: RoomState): RoomStage {
  switch (s.status) {
    case "accepting":
      return s.accept && s.accept.accepted >= s.accept.required ? "allocating" : "accept"
    case "veto":
      return s.veto?.state.done ? "allocating" : "veto"
    case "allocating":
    case "starting":
      return "allocating"
    case "ready":
      return s.server ? "connect" : "allocating"
    case "live":
      return "live"
    case "finished":
    case "abandoned":
      return "result"
    case "cancelled":
      return "cancelled"
  }
}

// Path of the room for a match. Older matches without a room id use the uuid
export function roomPath(m: { matchId?: string; id?: string; slug?: string | null }): string {
  return `/matches/${m.slug || m.matchId || m.id}`
}
