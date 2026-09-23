import { z } from "zod"
import { SteamId64Schema } from "./common.js"

export const PlayerStatsSchema = z.object({
  steamId: SteamId64Schema,
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  damage: z.number().nonnegative(),
})
export type PlayerStats = z.infer<typeof PlayerStatsSchema>

const ScoreSchema = z.record(z.string(), z.number().int().nonnegative())

export const MatchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("server_ready") }),
  z.object({ type: z.literal("player_connected"), steamId: SteamId64Schema }),
  z.object({ type: z.literal("player_disconnected"), steamId: SteamId64Schema }),
  z.object({ type: z.literal("match_started") }),
  z.object({
    type: z.literal("round_end"),
    round: z.number().int().nonnegative(),
    // Team name, or "draw"
    winnerTeam: z.string(),
    score: ScoreSchema,
    // Rush room id or name when known
    arena: z.string().optional(),
  }),
  z.object({
    type: z.literal("match_end"),
    // Team name, or "draw"
    winnerTeam: z.string(),
    score: ScoreSchema,
    players: z.array(PlayerStatsSchema),
    demoUploaded: z.boolean(),
  }),
  z.object({
    type: z.literal("match_abandoned"),
    reason: z.string(),
    missingSteamIds: z.array(SteamId64Schema),
  }),
  z.object({
    type: z.literal("kill"),
    // Round the kill happened in, counting from 1
    round: z.number().int().positive(),
    tick: z.number().int().nonnegative(),
    attacker: SteamId64Schema,
    victim: SteamId64Schema,
    weapon: z.string().min(1).max(64),
    headshot: z.boolean(),
    wallbang: z.boolean(),
    assister: SteamId64Schema.optional(),
  }),
  z.object({
    type: z.literal("demo_uploaded"),
    ok: z.boolean(),
    bytes: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }),
])
export type MatchEvent = z.infer<typeof MatchEventSchema>
export type MatchEventType = MatchEvent["type"]

export const DRAW_WINNER = "draw"

export const MatchWebhookBodySchema = z.object({ event: MatchEventSchema })
export type MatchWebhookBody = z.infer<typeof MatchWebhookBodySchema>

export const WEBHOOK_SIGNATURE_HEADER = "X-Rushsite-Signature"
export const WEBHOOK_SIGNATURE_PREFIX = "sha256="
