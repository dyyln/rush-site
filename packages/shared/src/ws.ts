import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./schemas/common.js"
import { ModeSchema } from "./schemas/mode.js"
import { TrustLevelSchema } from "./schemas/trust.js"
import { VetoStateSchema } from "./schemas/veto.js"
import { TierIdSchema } from "./config/tiers.js"

// Every message on /ws is { type, payload, ts } with ts in epoch milliseconds
export const WsEnvelopeSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  ts: z.number(),
})
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>

const msg = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), payload, ts: z.number() })

// Server to client payloads

export const QueueStatusPayloadSchema = z.object({
  state: z.enum(["idle", "queued", "cooldown"]),
  mode: ModeSchema.nullable(),
  partyId: UuidSchema.nullable(),
  // Epoch ms
  queuedAt: z.number().nullable(),
  // Epoch ms, set when state is cooldown
  cooldownUntil: z.number().nullable(),
  playersInQueue: z.number().int().nonnegative().optional(),
})
export type QueueStatusPayload = z.infer<typeof QueueStatusPayloadSchema>

export const MatchFoundPayloadSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  // Epoch ms when the accept window closes
  acceptDeadline: z.number(),
  acceptWindowSec: z.number().int().positive(),
  accepted: z.number().int().nonnegative(),
  required: z.number().int().positive(),
})
export type MatchFoundPayload = z.infer<typeof MatchFoundPayloadSchema>

export const VetoStatePayloadSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  state: VetoStateSchema,
  // Epoch ms when the current step resolves. null once the veto is done
  stepDeadline: z.number().nullable(),
})
export type VetoStatePayload = z.infer<typeof VetoStatePayloadSchema>

export const ServerReadyPayloadSchema = z.object({
  matchId: UuidSchema,
  ip: z.string(),
  port: z.number().int(),
  // Full console connect string including the password
  connect: z.string(),
  mapId: z.string(),
})
export type ServerReadyPayload = z.infer<typeof ServerReadyPayloadSchema>

export const RatingChangeSchema = z.object({
  steamId: SteamId64Schema,
  before: z.number(),
  after: z.number(),
  tierBefore: TierIdSchema,
  tierAfter: TierIdSchema,
})
export type RatingChange = z.infer<typeof RatingChangeSchema>

export const MatchResultPayloadSchema = z.object({
  matchId: UuidSchema,
  mode: ModeSchema,
  status: z.enum(["completed", "abandoned"]),
  winnerTeam: z.string().nullable(),
  score: z.record(z.string(), z.number()),
  ratingChanges: z.array(RatingChangeSchema),
})
export type MatchResultPayload = z.infer<typeof MatchResultPayloadSchema>

export const PartyMemberSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
})
export type PartyMember = z.infer<typeof PartyMemberSchema>

export const PartyUpdatePayloadSchema = z.object({
  // null when the user is no longer in a party
  partyId: UuidSchema.nullable(),
  leaderSteamId: SteamId64Schema.nullable(),
  members: z.array(PartyMemberSchema),
  inviteCode: z.string().nullable(),
})
export type PartyUpdatePayload = z.infer<typeof PartyUpdatePayloadSchema>

export const TournamentStatusSchema = z.enum(["open", "running", "completed", "cancelled"])
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>

export const TournamentSummarySchema = z.object({
  id: UuidSchema,
  cupKey: z.string(),
  name: z.string(),
  mode: ModeSchema,
  cadence: z.enum(["daily", "weekly"]),
  status: TournamentStatusSchema,
  // ISO timestamps
  startsAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  maxEntrants: z.number().int().positive(),
  entrantCount: z.number().int().nonnegative(),
  minTrust: TrustLevelSchema,
  entryFee: z.number().int().nonnegative(),
  format: z.object({
    type: z.literal("single_elimination"),
    bestOf: z.object({
      default: z.number().int().positive(),
      semis: z.number().int().positive(),
      final: z.number().int().positive(),
    }),
  }),
  checkIn: z.literal(false),
  winnerEntryId: UuidSchema.nullable(),
})
export type TournamentSummary = z.infer<typeof TournamentSummarySchema>

export const BracketSideSchema = z.enum(["a", "b"])

export const BracketMatchSchema = z.object({
  // Stable key such as r1m0
  id: z.string(),
  round: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  bestOf: z.number().int().positive(),
  // Entry ids. null is a bye or an empty slot
  a: UuidSchema.nullable(),
  b: UuidSchema.nullable(),
  aSeed: z.number().int().positive().nullable(),
  bSeed: z.number().int().positive().nullable(),
  aResolved: z.boolean(),
  bResolved: z.boolean(),
  status: z.enum(["pending", "ready", "live", "done"]),
  games: z.array(z.object({ matchId: UuidSchema, winner: BracketSideSchema })),
  liveMatchId: UuidSchema.nullable(),
  winner: UuidSchema.nullable(),
  resolution: z
    .enum(["played", "bye", "walkover", "forfeit", "double_forfeit", "void"])
    .nullable(),
})
export type BracketMatchView = z.infer<typeof BracketMatchSchema>

export const BracketSchema = z.object({
  size: z.number().int().positive(),
  rounds: z.number().int().nonnegative(),
  matches: z.array(BracketMatchSchema),
})
export type BracketView = z.infer<typeof BracketSchema>

export const TournamentUpdatePayloadSchema = z.object({
  kind: z.enum([
    "created",
    "entries_changed",
    "started",
    "cancelled",
    "match_live",
    "match_updated",
    "completed",
  ]),
  tournament: TournamentSummarySchema,
  // Present on started, match_live, match_updated and completed
  bracket: BracketSchema.optional(),
  // The bracket match that changed, on match_live and match_updated
  bracketMatchId: z.string().optional(),
})
export type TournamentUpdatePayload = z.infer<typeof TournamentUpdatePayloadSchema>

export const ServerMessageSchema = z.discriminatedUnion("type", [
  msg("queue_status", QueueStatusPayloadSchema),
  msg("match_found", MatchFoundPayloadSchema),
  msg("veto_state", VetoStatePayloadSchema),
  msg("server_ready", ServerReadyPayloadSchema),
  msg("match_result", MatchResultPayloadSchema),
  msg("party_update", PartyUpdatePayloadSchema),
  msg("tournament_update", TournamentUpdatePayloadSchema),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>
export type ServerMessageType = ServerMessage["type"]

// Client to server payloads

export const AcceptMatchPayloadSchema = z.object({
  matchId: UuidSchema,
  // false declines
  accept: z.boolean(),
})
export type AcceptMatchPayload = z.infer<typeof AcceptMatchPayloadSchema>

export const VetoVotePayloadSchema = z.object({
  matchId: UuidSchema,
  mapId: z.string().min(1),
})
export type VetoVotePayload = z.infer<typeof VetoVotePayloadSchema>

export const QueueJoinPayloadSchema = z.object({ mode: ModeSchema })
export type QueueJoinPayload = z.infer<typeof QueueJoinPayloadSchema>

export const QueueLeavePayloadSchema = z.object({})
export type QueueLeavePayload = z.infer<typeof QueueLeavePayloadSchema>

export const ClientMessageSchema = z.discriminatedUnion("type", [
  msg("accept_match", AcceptMatchPayloadSchema),
  msg("veto_vote", VetoVotePayloadSchema),
  msg("queue_join", QueueJoinPayloadSchema),
  msg("queue_leave", QueueLeavePayloadSchema),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ClientMessageType = ClientMessage["type"]

type PayloadOf<U extends { type: string; payload: unknown }, T extends U["type"]> = Extract<U, { type: T }>["payload"]

export function serverMessage<T extends ServerMessageType>(
  type: T,
  payload: PayloadOf<ServerMessage, T>,
  ts: number = Date.now(),
): Extract<ServerMessage, { type: T }> {
  return { type, payload, ts } as Extract<ServerMessage, { type: T }>
}

export function clientMessage<T extends ClientMessageType>(
  type: T,
  payload: PayloadOf<ClientMessage, T>,
  ts: number = Date.now(),
): Extract<ClientMessage, { type: T }> {
  return { type, payload, ts } as Extract<ClientMessage, { type: T }>
}
