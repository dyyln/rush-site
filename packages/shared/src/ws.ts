import { z } from "zod"
import { PlayerCardSchema, SteamId64Schema, UuidSchema } from "./schemas/common.js"
import { ModeSchema } from "./schemas/mode.js"
import { TrustLevelSchema } from "./schemas/trust.js"
import { VetoStateSchema } from "./schemas/veto.js"
import { MatchRoundSchema, MatchStatusSchema } from "./schemas/match.js"
import { TierIdSchema } from "./config/tiers.js"
import { ChallengeUpdatePayloadSchema } from "./schemas/challenges.js"
import { FriendUpdatePayloadSchema, PartyInvitePayloadSchema } from "./schemas/friends.js"
import { CupEntrantPreviewSchema, CupWinnerSchema } from "./schemas/cups-ux.js"

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

const uniqueModes = (arr: string[]) => new Set(arr).size === arr.length

export const QueueModeStatusSchema = z.object({
  mode: ModeSchema,
  // Epoch ms
  queuedAt: z.number(),
  waitSec: z.number().nonnegative(),
  // Median recent wait for the mode. null when there are too few samples
  estimatedSec: z.number().nonnegative().nullable().optional(),
  // Current max rating gap from the widen schedule. null means any gap
  ratingWindow: z.number().nonnegative().nullable(),
  playersInQueue: z.number().int().nonnegative().optional(),
  matchesInProgress: z.number().int().nonnegative().optional(),
})
export type QueueModeStatus = z.infer<typeof QueueModeStatusSchema>

export const QueueStatusPayloadSchema = z.object({
  state: z.enum(["idle", "queued", "cooldown"]),
  partyId: UuidSchema.nullable(),
  // One entry per mode the user or party is queued for. Empty when idle
  modes: z.array(QueueModeStatusSchema).refine((m) => uniqueModes(m.map((x) => x.mode)), "duplicate mode"),
  // Epoch ms, set when state is cooldown
  cooldownUntil: z.number().nullable(),
  // Opponent trust floor of the ticket. Set when queued
  minTrust: TrustLevelSchema.optional(),
  // True only on the periodic refresh. A slow socket may drop these, never a state change
  refresh: z.boolean().optional(),
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
  port: z.number().int().min(1).max(65535),
  password: z.string(),
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

export const PartyMemberSchema = PlayerCardSchema
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
  // special is a one-off cup created by an admin
  cadence: z.enum(["daily", "weekly", "special"]),
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
  // The signed-in viewer's entry. Only set on list rows for signed-in viewers
  myEntryId: UuidSchema.nullable().optional(),
  // First entries by sign up order, at most 5
  entrantPreview: z.array(CupEntrantPreviewSchema).optional(),
  // Set on completed cups with a winner
  winner: CupWinnerSchema.nullable().optional(),
})
export type TournamentSummary = z.infer<typeof TournamentSummarySchema>

export const EntryPlayerSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  // Rating and tier in the cup's mode. null and unranked when the player has no rating there
  rating: z.number().nullable(),
  tier: z.union([TierIdSchema, z.literal("unranked")]),
})
export type EntryPlayer = z.infer<typeof EntryPlayerSchema>

export const TournamentEntrySchema = z.object({
  id: UuidSchema,
  captainSteamId: SteamId64Schema,
  steamIds: z.array(SteamId64Schema),
  seed: z.number().int().positive().nullable(),
  rating: z.number().nullable(),
  // ISO timestamp
  registeredAt: z.string(),
  // Display name. The team name when set, otherwise the captain's display name
  name: z.string().optional(),
  // Team name chosen at entry for 2v2 and 3v3 cups
  teamName: z.string().nullable().optional(),
  // Set when an admin disqualified the entry
  disqualified: z.boolean().optional(),
  players: z.array(EntryPlayerSchema).optional(),
})
export type TournamentEntry = z.infer<typeof TournamentEntrySchema>

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
  // provisioning means a server is being requested for the next game
  status: z.enum(["pending", "ready", "provisioning", "live", "done"]),
  games: z.array(z.object({ matchId: UuidSchema, winner: BracketSideSchema })),
  liveMatchId: UuidSchema.nullable(),
  winner: UuidSchema.nullable(),
  resolution: z
    .enum(["played", "bye", "walkover", "forfeit", "double_forfeit", "void", "disqualified", "admin_decision"])
    .nullable(),
})
export type BracketMatchView = z.infer<typeof BracketMatchSchema>

export const BracketSchema = z.object({
  size: z.number().int().positive(),
  rounds: z.number().int().nonnegative(),
  matches: z.array(BracketMatchSchema),
})
export type BracketView = z.infer<typeof BracketSchema>

export const TournamentDetailSchema = TournamentSummarySchema.extend({
  entries: z.array(TournamentEntrySchema),
  bracket: BracketSchema.nullable(),
  // Same value as the bracket ETag
  bracketVersion: z.number().int().nonnegative(),
  myEntryId: UuidSchema.nullable(),
})
export type TournamentDetail = z.infer<typeof TournamentDetailSchema>

export const TournamentUpdatePayloadSchema = z.object({
  kind: z.enum([
    "created",
    "entries_changed",
    "started",
    "cancelled",
    "match_live",
    "match_updated",
    "completed",
    "rescheduled",
  ]),
  tournament: TournamentSummarySchema,
  // Bumped on every bracket change. Viewers refetch GET /tournaments/:id/bracket when it moves
  bracketVersion: z.number().int().nonnegative(),
  // The bracket match that changed, on match_live and match_updated
  bracketMatchId: z.string().optional(),
})
export type TournamentUpdatePayload = z.infer<typeof TournamentUpdatePayloadSchema>

// GET /tournaments/:id/bracket. The ETag header carries the same version
export const TournamentBracketResponseSchema = z.object({
  tournamentId: UuidSchema,
  version: z.number().int().nonnegative(),
  bracket: BracketSchema.nullable(),
})
export type TournamentBracketResponse = z.infer<typeof TournamentBracketResponseSchema>

export const ModeStatsSchema = z.object({
  mode: ModeSchema,
  playersInQueue: z.number().int().nonnegative(),
  matchesInProgress: z.number().int().nonnegative(),
})
export type ModeStats = z.infer<typeof ModeStatsSchema>

// Broadcast to every connected client every few seconds and on change
export const ModeStatsPayloadSchema = z.object({
  modes: z.array(ModeStatsSchema),
})
export type ModeStatsPayload = z.infer<typeof ModeStatsPayloadSchema>

export const AdminEventKindSchema = z.enum(["queue", "match", "host", "webhook", "error", "user"])
export type AdminEventKind = z.infer<typeof AdminEventKindSchema>

// Sent to admin clients only
export const AdminEventPayloadSchema = z.object({
  kind: AdminEventKindSchema,
  payload: z.unknown(),
})
export type AdminEventPayload = z.infer<typeof AdminEventPayloadSchema>

export const MatchCancelledPayloadSchema = z.object({
  matchId: UuidSchema,
  reason: z.string(),
})
export type MatchCancelledPayload = z.infer<typeof MatchCancelledPayloadSchema>

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  // Id of the request or entity the error refers to
  ref: z.string().optional(),
})
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>

// Sent to match subscribers on match_started, round_end, match_end and cancel
export const MatchUpdatePayloadSchema = z.object({
  matchId: UuidSchema,
  status: MatchStatusSchema,
  teams: z.array(z.object({ name: z.string(), score: z.number().int().nonnegative() })),
  lastRound: MatchRoundSchema.optional(),
  // Warm-up progress, sent to participants on player_connected and player_disconnected
  connected: z.number().int().nonnegative().optional(),
  expected: z.number().int().nonnegative().optional(),
})
export type MatchUpdatePayload = z.infer<typeof MatchUpdatePayloadSchema>

export const ServerMessageSchema = z.discriminatedUnion("type", [
  msg("queue_status", QueueStatusPayloadSchema),
  msg("match_found", MatchFoundPayloadSchema),
  msg("veto_state", VetoStatePayloadSchema),
  msg("server_ready", ServerReadyPayloadSchema),
  msg("match_result", MatchResultPayloadSchema),
  msg("party_update", PartyUpdatePayloadSchema),
  msg("tournament_update", TournamentUpdatePayloadSchema),
  msg("mode_stats", ModeStatsPayloadSchema),
  msg("admin_event", AdminEventPayloadSchema),
  msg("match_cancelled", MatchCancelledPayloadSchema),
  msg("error", ErrorPayloadSchema),
  msg("match_update", MatchUpdatePayloadSchema),
  msg("challenge_update", ChallengeUpdatePayloadSchema),
  msg("friend_update", FriendUpdatePayloadSchema),
  msg("party_invite", PartyInvitePayloadSchema),
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
  mapId: z.string().min(1).max(64),
})
export type VetoVotePayload = z.infer<typeof VetoVotePayloadSchema>

export const QueueJoinPayloadSchema = z.object({
  modes: z.array(ModeSchema).min(1).refine(uniqueModes, "duplicate mode"),
  // Lowest trust level an opponent may have. Omitted means the saved setting, which defaults to new
  minTrust: TrustLevelSchema.optional(),
})
export type QueueJoinPayload = z.infer<typeof QueueJoinPayloadSchema>

// Omit modes to leave every queue
export const QueueLeavePayloadSchema = z.object({
  modes: z.array(ModeSchema).min(1).refine(uniqueModes, "duplicate mode").optional(),
})
export type QueueLeavePayload = z.infer<typeof QueueLeavePayloadSchema>

export const SubscribeMatchPayloadSchema = z.object({ matchId: UuidSchema })
export type SubscribeMatchPayload = z.infer<typeof SubscribeMatchPayloadSchema>

export const UnsubscribeMatchPayloadSchema = z.object({ matchId: UuidSchema })
export type UnsubscribeMatchPayload = z.infer<typeof UnsubscribeMatchPayloadSchema>

// match_live, match_updated and entries_changed go only to subscribers of that tournament
export const SubscribeTournamentPayloadSchema = z.object({ tournamentId: UuidSchema })
export type SubscribeTournamentPayload = z.infer<typeof SubscribeTournamentPayloadSchema>

export const UnsubscribeTournamentPayloadSchema = z.object({ tournamentId: UuidSchema })
export type UnsubscribeTournamentPayload = z.infer<typeof UnsubscribeTournamentPayloadSchema>

export const ClientMessageSchema = z.discriminatedUnion("type", [
  msg("accept_match", AcceptMatchPayloadSchema),
  msg("veto_vote", VetoVotePayloadSchema),
  msg("queue_join", QueueJoinPayloadSchema),
  msg("queue_leave", QueueLeavePayloadSchema),
  msg("subscribe_match", SubscribeMatchPayloadSchema),
  msg("unsubscribe_match", UnsubscribeMatchPayloadSchema),
  msg("subscribe_tournament", SubscribeTournamentPayloadSchema),
  msg("unsubscribe_tournament", UnsubscribeTournamentPayloadSchema),
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
