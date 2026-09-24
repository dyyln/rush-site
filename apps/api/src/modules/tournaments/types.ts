import type { FastifyRequest } from "fastify"
import type { PgDatabase } from "drizzle-orm/pg-core"

import type {
  Mode,
  TournamentDetail,
  TournamentEntry as EntryView,
  TournamentStatus,
  TournamentSummary,
  TournamentUpdatePayload,
  TrustLevel,
} from "@rushsite/shared"

export type { EntryView, Mode, TournamentDetail, TournamentStatus, TournamentSummary, TournamentUpdatePayload, TrustLevel }
export type CupCadence = TournamentSummary["cadence"]
export type TournamentUpdateKind = TournamentUpdatePayload["kind"]
export type BadgeKind = "cup_champion" | "cup_runner_up" | "cup_semifinalist"

// What the tournaments module asks the api to do for one game of a bracket series.
export interface StartMatchParams {
  mode: Mode
  // Exactly two teams. The result must name the winner by one of these names.
  // name is the team id the result uses. displayName is the cup team name when set.
  teams: [
    { name: string; steamIds: string[]; displayName?: string },
    { name: string; steamIds: string[]; displayName?: string },
  ]
  // Tournament games skip the queue and the accept step.
  // A best-of series runs on one server. gameNumber is the first map it plays,
  // above 1 only when the series resumes after a crash with the maps in priorMaps already decided.
  source: {
    kind: "tournament"
    tournamentId: string
    bracketMatchId: string
    gameNumber: number
    bestOf: number
    priorMaps?: SeriesMap[]
    // Team index of the higher seed (the lower seed number). It picks first in a Rush series room veto
    higherSeed?: 0 | 1
  }
}

// One decided map of a series and the match it was played on
export interface SeriesMap {
  mapNumber: number
  winnerTeam: string
  matchId: string
}

// A map of a running series is decided. The series result follows as a MatchResult
export interface MapResult {
  matchId: string
  mapNumber: number
  winnerTeam: string
}

export type MapResultHandler = (result: MapResult) => Promise<void>

export type MatchResult =
  // maps is set for a series. score is then maps won
  | { matchId: string; outcome: "completed"; winnerTeam: string; score: Record<string, number>; maps?: SeriesMap[] }
  | { matchId: string; outcome: "abandoned"; reason: string; missingSteamIds: string[] }
  // The match never ran, for example allocation failed. The module provisions it again.
  | { matchId: string; outcome: "cancelled"; reason: string }

export type MatchResultHandler = (result: MatchResult) => Promise<void>

export interface WsMessage<T = unknown> {
  type: string
  payload: T
  ts: number
}

export type EmitAudience =
  | { kind: "broadcast" }
  | { kind: "users"; steamIds: string[] }
  | { kind: "tournament"; tournamentId: string }

export interface PartyInfo {
  partyId: string
  leaderSteamId: string
  memberSteamIds: string[]
}

// Any drizzle postgres database, node-postgres or postgres-js.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>

export interface TournamentsPluginOptions {
  db: Db
  startMatch(params: StartMatchParams): Promise<{ matchId: string }>
  onMatchResult(handler: MatchResultHandler): void
  // Per map results of a series, for the live bracket. Optional in tests
  onMapResult?(handler: MapResultHandler): void
  emit(message: WsMessage<TournamentUpdatePayload>, audience?: EmitAudience): void
  // Returns the signed in user's SteamID64 or null.
  authenticate(request: FastifyRequest): Promise<string | null>
  getTrustLevels(steamIds: string[]): Promise<Record<string, TrustLevel>>
  // Current rating per player for the mode. Leave out players with no rating there.
  getRatings(steamIds: string[], mode: Mode): Promise<Record<string, number>>
  // Needed for 2v2 and 3v3 cups. The party leader enters the whole party.
  getParty(steamId: string): Promise<PartyInfo | null>
  // Display names and avatars. Missing players fall back to their SteamID64.
  getProfiles(steamIds: string[]): Promise<Record<string, ProfileInfo>>
  // Admin routes under /admin/tournaments are registered only when this is given.
  isAdmin?(steamId: string): boolean
  // Stops a CS2 match that no longer counts after a cancel, disqualification or forced result.
  cancelMatch?(matchId: string, reason: string): Promise<unknown>
  // False when an admin closed the mode through its queue flag
  modeGate?(mode: Mode): Promise<boolean>
  // Defaults to true. Tests turn it off.
  scheduler?: boolean
  schedulerIntervalMs?: number
  now?: () => Date
  // Seeds cup_schedules when it is empty. Used by tests with the memory store.
  cups?: import("./config.js").CupDefinition[]
}

export type ProfileInfo = { displayName: string; avatarUrl: string | null }
