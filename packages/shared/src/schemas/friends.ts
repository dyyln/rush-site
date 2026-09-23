import { z } from "zod"
import { TierIdSchema } from "../config/tiers.js"
import { PlayerCardSchema, SteamId64Schema, UuidSchema } from "./common.js"
import { ModeSchema } from "./mode.js"

// In-site party invites expire after this long
export const PARTY_INVITE_TTL_SEC = 600
// Presence keys live this long without a refresh
export const PRESENCE_TTL_SEC = 60

export const PresenceSchema = z.enum(["offline", "online", "queue", "match"])
export type Presence = z.infer<typeof PresenceSchema>

// What a friend is doing. Match fields are set in a match, modes while queued
export const PresenceDetailSchema = z.object({
  matchId: UuidSchema.optional(),
  mode: ModeSchema.optional(),
  // null until the veto picks the map
  mapId: z.string().nullable().optional(),
  // The friend's team first
  score: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  modes: z.array(ModeSchema).optional(),
})
export type PresenceDetail = z.infer<typeof PresenceDetailSchema>

export const FriendSourceSchema = z.enum(["steam", "request"])
export type FriendSource = z.infer<typeof FriendSourceSchema>

export const FriendRequestStatusSchema = z.enum(["pending", "accepted", "declined", "cancelled"])
export type FriendRequestStatus = z.infer<typeof FriendRequestStatusSchema>

export const PartyInviteStatusSchema = z.enum(["pending", "accepted", "declined", "expired"])
export type PartyInviteStatus = z.infer<typeof PartyInviteStatusSchema>

export const FriendCardSchema = PlayerCardSchema
export type FriendCard = z.infer<typeof FriendCardSchema>

export const FriendTierSchema = z.union([TierIdSchema, z.literal("unranked")])
export type FriendTier = z.infer<typeof FriendTierSchema>

export const FriendSchema = FriendCardSchema.extend({
  presence: PresenceSchema,
  detail: PresenceDetailSchema.optional(),
  source: FriendSourceSchema,
  // unranked when the friend has no match in that mode
  tiers: z.record(ModeSchema, FriendTierSchema),
})
export type Friend = z.infer<typeof FriendSchema>

export const FriendRequestSchema = z.object({
  id: UuidSchema,
  from: FriendCardSchema,
  to: FriendCardSchema,
  status: FriendRequestStatusSchema,
  // ISO timestamps
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
})
export type FriendRequest = z.infer<typeof FriendRequestSchema>

// A Steam friend who has not signed in here yet. Only used for the Send link action
export const SteamOnlyFriendSchema = FriendCardSchema.extend({
  // Steam persona state. 0 offline, 1 online, 2 busy, 3 away and so on
  personaState: z.number().int().nonnegative(),
})
export type SteamOnlyFriend = z.infer<typeof SteamOnlyFriendSchema>

export const FriendsResponseSchema = z.object({
  friends: z.array(FriendSchema),
  incoming: z.array(FriendRequestSchema),
  outgoing: z.array(FriendRequestSchema),
  // False when the Steam list could not be read (private profile or no API key)
  steamListAvailable: z.boolean(),
  // Steam friends without an account here. Empty when the Steam list is unavailable
  steamOnly: z.array(SteamOnlyFriendSchema),
})
export type FriendsResponse = z.infer<typeof FriendsResponseSchema>

export const FriendRequestBodySchema = z.object({ steamId: SteamId64Schema })
export type FriendRequestBody = z.infer<typeof FriendRequestBodySchema>

export const RecentPlayerSchema = FriendCardSchema.extend({
  matchId: UuidSchema,
  mode: ModeSchema,
  // ISO timestamp of the last match played together
  playedAt: z.string(),
  // True when the viewer already sent this player a pending request
  requested: z.boolean(),
})
export type RecentPlayer = z.infer<typeof RecentPlayerSchema>

export const RecentPlayersResponseSchema = z.object({ players: z.array(RecentPlayerSchema) })
export type RecentPlayersResponse = z.infer<typeof RecentPlayersResponseSchema>

export const PartyInviteSchema = z.object({
  id: UuidSchema,
  partyId: UuidSchema,
  from: FriendCardSchema,
  inviteCode: z.string(),
  // ISO timestamp
  expiresAt: z.string(),
  status: PartyInviteStatusSchema.optional(),
})
export type PartyInvite = z.infer<typeof PartyInviteSchema>

export const PartyInviteBodySchema = z.object({ steamId: SteamId64Schema })
export type PartyInviteBody = z.infer<typeof PartyInviteBodySchema>

// Counts for the header badge
export const FriendsPendingResponseSchema = z.object({
  requests: z.number().int().nonnegative(),
  invites: z.array(PartyInviteSchema),
})
export type FriendsPendingResponse = z.infer<typeof FriendsPendingResponseSchema>

export const FriendUpdateKindSchema = z.enum(["request", "accepted", "declined", "removed", "presence"])
export type FriendUpdateKind = z.infer<typeof FriendUpdateKindSchema>

// steamId is the other player from the receiver's point of view
export const FriendUpdatePayloadSchema = z.object({
  kind: FriendUpdateKindSchema,
  steamId: SteamId64Schema,
  request: FriendRequestSchema.optional(),
  presence: PresenceSchema.optional(),
  detail: PresenceDetailSchema.optional(),
})
export type FriendUpdatePayload = z.infer<typeof FriendUpdatePayloadSchema>

export const PartyInvitePayloadSchema = z.object({ invite: PartyInviteSchema })
export type PartyInvitePayload = z.infer<typeof PartyInvitePayloadSchema>
