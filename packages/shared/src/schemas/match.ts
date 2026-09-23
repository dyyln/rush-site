import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { ModeSchema } from "./mode.js"
import { TierIdSchema } from "../config/tiers.js"
import { ServerDriverNameSchema } from "../drivers.js"

export const MatchStatusSchema = z.enum([
  "accepting",
  "veto",
  "allocating",
  "starting",
  "ready",
  "live",
  "finished",
  "abandoned",
  "cancelled",
])
export type MatchStatus = z.infer<typeof MatchStatusSchema>

// ISO 8601 timestamp string
const IsoDateSchema = z.string()

export const MatchRoundSchema = z.object({
  round: z.number().int().nonnegative(),
  // Team name, or "draw"
  winnerTeam: z.string(),
  score: z.record(z.string(), z.number().int().nonnegative()),
  arena: z.string().optional(),
  endedAt: IsoDateSchema,
})
export type MatchRound = z.infer<typeof MatchRoundSchema>

export const MatchDetailPlayerSchema = z.object({
  steamId: SteamId64Schema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  tier: TierIdSchema,
  rating: z.number(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  damage: z.number().nonnegative(),
})
export type MatchDetailPlayer = z.infer<typeof MatchDetailPlayerSchema>

export const MatchDetailTeamSchema = z.object({
  name: z.string(),
  score: z.number().int().nonnegative(),
  players: z.array(MatchDetailPlayerSchema),
})
export type MatchDetailTeam = z.infer<typeof MatchDetailTeamSchema>

export const MatchDetailSchema = z.object({
  id: UuidSchema,
  mode: ModeSchema,
  mapId: z.string().nullable(),
  status: MatchStatusSchema,
  // null until a server is allocated
  driver: ServerDriverNameSchema.nullable(),
  startedAt: IsoDateSchema.nullable(),
  endedAt: IsoDateSchema.nullable(),
  teams: z.array(MatchDetailTeamSchema),
  rounds: z.array(MatchRoundSchema),
  // Challenges and rematches. No rating change
  unrated: z.boolean().optional(),
  tournament: z
    .object({
      id: UuidSchema,
      name: z.string(),
      // Bracket key such as r1m0
      bracketMatchId: z.string().min(1),
      bestOf: z.number().int().positive(),
      gameNumber: z.number().int().positive(),
    })
    .optional(),
  // Only included for participants
  connect: z
    .object({
      ip: z.string(),
      port: z.number().int().min(1).max(65535),
      password: z.string(),
      connect: z.string(),
    })
    .optional(),
})
export type MatchDetail = z.infer<typeof MatchDetailSchema>

// Body of GET /matches/:id
export const MatchDetailResponseSchema = z.object({ match: MatchDetailSchema })
export type MatchDetailResponse = z.infer<typeof MatchDetailResponseSchema>
