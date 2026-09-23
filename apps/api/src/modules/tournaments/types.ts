import type { FastifyRequest } from "fastify"
import type { PgDatabase } from "drizzle-orm/pg-core"

import type {
  Mode,
  TournamentStatus,
  TournamentSummary,
  TournamentUpdatePayload,
  TrustLevel,
} from "@rushsite/shared"

export type { Mode, TournamentStatus, TournamentSummary, TournamentUpdatePayload, TrustLevel }
export type CupCadence = TournamentSummary["cadence"]
export type TournamentUpdateKind = TournamentUpdatePayload["kind"]
export type BadgeKind = "cup_champion" | "cup_runner_up" | "cup_semifinalist"

// What the tournaments module asks the api to do for one game of a bracket series.
export interface StartMatchParams {
  mode: Mode
  // Exactly two teams. The result must name the winner by one of these names.
  teams: [{ name: string; steamIds: string[] }, { name: string; steamIds: string[] }]
  // Tournament games skip the queue and the accept step.
  source: {
    kind: "tournament"
    tournamentId: string
    bracketMatchId: string
    gameNumber: number
    bestOf: number
  }
}

export type MatchResult =
  | { matchId: string; outcome: "completed"; winnerTeam: string; score: Record<string, number> }
  | { matchId: string; outcome: "abandoned"; reason: string; missingSteamIds: string[] }
  // The match never ran, for example allocation failed. The module provisions it again.
  | { matchId: string; outcome: "cancelled"; reason: string }

export type MatchResultHandler = (result: MatchResult) => Promise<void>

export interface WsMessage<T = unknown> {
  type: string
  payload: T
  ts: number
}

export type EmitAudience = { kind: "broadcast" } | { kind: "users"; steamIds: string[] }

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
  emit(message: WsMessage<TournamentUpdatePayload>, audience?: EmitAudience): void
  // Returns the signed in user's SteamID64 or null.
  authenticate(request: FastifyRequest): Promise<string | null>
  getTrustLevels(steamIds: string[]): Promise<Record<string, TrustLevel>>
  // Current rating per player for the mode. Missing players get the default rating.
  getRatings(steamIds: string[], mode: Mode): Promise<Record<string, number>>
  // Needed for 2v2 and 3v3 cups. The party leader enters the whole party.
  getParty(steamId: string): Promise<PartyInfo | null>
  // Defaults to true. Tests turn it off.
  scheduler?: boolean
  schedulerIntervalMs?: number
  now?: () => Date
  cups?: import("./config.js").CupDefinition[]
}

export interface EntryView {
  id: string
  captainSteamId: string
  steamIds: string[]
  seed: number | null
  rating: number | null
  registeredAt: string
}
