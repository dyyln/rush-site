import { z } from "zod"
import { CHAT_LIMITS } from "../config/chat.js"
import { TierIdSchema } from "../config/tiers.js"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { TrustLevelSchema } from "./trust.js"

export const CHAT_GLOBAL_CHANNEL = "global"
export const CHAT_MAX_LENGTH = 280
// Messages returned by one history request
export const CHAT_HISTORY_LIMIT = 50
// Per user posting limit across every channel
export const CHAT_RATE = CHAT_LIMITS.rate
// Longest mute an admin can set. Null in a mute request means permanent
export const CHAT_MUTE_MAX_MINUTES = 60 * 24 * 30

// global, or match:<match id> for a match room channel later
export const ChatChannelSchema = z
  .string()
  .regex(/^(global|match:[a-z0-9-]{1,64})$/, "unknown channel")
export type ChatChannel = z.infer<typeof ChatChannelSchema>

export const ChatAuthorSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  trustLevel: TrustLevelSchema,
  // Best tier across modes. unranked before any rated match
  tier: z.union([TierIdSchema, z.literal("unranked")]),
  admin: z.boolean(),
})
export type ChatAuthor = z.infer<typeof ChatAuthorSchema>

export const ChatMessageSchema = z.object({
  id: UuidSchema,
  channel: ChatChannelSchema,
  author: ChatAuthorSchema,
  body: z.string(),
  // ISO timestamp
  createdAt: z.string(),
  // Text before masking. Only sent to admins, and only when the filter changed it
  originalBody: z.string().optional(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatDeletedPayloadSchema = z.object({
  id: UuidSchema,
  channel: ChatChannelSchema,
})
export type ChatDeletedPayload = z.infer<typeof ChatDeletedPayloadSchema>

// POST /chat/messages
export const ChatPostSchema = z.object({
  channel: ChatChannelSchema.default(CHAT_GLOBAL_CHANNEL),
  body: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim())
    .pipe(z.string().min(1, "message is empty").max(CHAT_MAX_LENGTH, `at most ${CHAT_MAX_LENGTH} characters`)),
})
export type ChatPost = z.input<typeof ChatPostSchema>

export const ChatMuteStatusSchema = z.object({
  // ISO timestamp. null is permanent
  until: z.string().nullable(),
  reason: z.string(),
})
export type ChatMuteStatus = z.infer<typeof ChatMuteStatusSchema>

// GET /chat/messages. Oldest first
export const ChatHistoryResponseSchema = z.object({
  channel: ChatChannelSchema,
  messages: z.array(ChatMessageSchema),
  // Seconds between posts while the global slow mode is on. Missing when it is off
  slowModeSec: z.number().int().positive().optional(),
  // Set for signed in viewers only
  me: z.object({ muted: ChatMuteStatusSchema.nullable() }).optional(),
})
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>

// PUT /admin/chat/mutes/:steamId
export const ChatMuteRequestSchema = z.object({
  // null mutes until an admin lifts it
  minutes: z.number().int().min(1).max(CHAT_MUTE_MAX_MINUTES).nullable(),
  reason: z.string().trim().min(1).max(200),
})
export type ChatMuteRequest = z.infer<typeof ChatMuteRequestSchema>

export const ChatMuteViewSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  until: z.string().nullable(),
  reason: z.string(),
  mutedBy: SteamId64Schema,
  createdAt: z.string(),
})
export type ChatMuteView = z.infer<typeof ChatMuteViewSchema>
