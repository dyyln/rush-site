import { z } from "zod"
import { SteamId64Schema, UuidSchema } from "./common.js"
import { ModeSchema } from "./mode.js"
import { TierIdSchema } from "../config/tiers.js"
import { ServerDriverNameSchema } from "../drivers.js"
import { VetoStateSchema } from "./veto.js"

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

// Matches that are not over yet. Players in them cannot queue and their party roster is frozen
export const ACTIVE_MATCH_STATUSES = ["accepting", "veto", "allocating", "starting", "ready", "live"] as const satisfies readonly MatchStatus[]

// ISO 8601 timestamp string
const IsoDateSchema = z.string()

export const MatchRoundSchema = z.object({
  round: z.number().int().nonnegative(),
  // Team name, or "draw"
  winnerTeam: z.string(),
  score: z.record(z.string(), z.number().int().nonnegative()),
  arena: z.string().optional(),
  endedAt: IsoDateSchema,
  // Map number inside a series. Left out on single map matches
  mapNumber: z.number().int().positive().optional(),
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
  // Team id used in scores and results
  name: z.string(),
  // Cup team name when set. Show it instead of name
  displayName: z.string().optional(),
  score: z.number().int().nonnegative(),
  players: z.array(MatchDetailPlayerSchema),
  // Side the team plays, as in match.json. Left out means teams[0] is CT and teams[1] is T. Rush never swaps
  side: z.enum(["ct", "t"]).optional(),
})
export type MatchDetailTeam = z.infer<typeof MatchDetailTeamSchema>

export const MatchMapStatusSchema = z.enum(["upcoming", "live", "done"])
export type MatchMapStatus = z.infer<typeof MatchMapStatusSchema>

// Rush room ids for slots 0 to 6: T castle, 2 mid, start, 2 mid, CT castle. Same ids as RUSH_ROOMS
export const RushRoomsSchema = z.array(z.number().int()).length(7)

// One map of a match. A Bo1 has one entry, a series has bestOf entries
export const MatchMapSchema = z.object({
  mapNumber: z.number().int().positive(),
  mapId: z.string(),
  status: MatchMapStatusSchema,
  // Team name once the map is done
  winnerTeam: z.string().nullable(),
  // Rounds won per team name. Zero for upcoming maps
  score: z.record(z.string(), z.number().int().nonnegative()),
  // Same shape as the top level demo. url is a presigned GET that expires at expiresAt
  demo: z.object({ available: z.boolean(), url: z.string().optional(), expiresAt: z.string().optional() }).optional(),
  // Set when a series resumed after a server crash and this map was played on that earlier match
  playedIn: z.string().optional(),
  // Stat lines for this map only
  players: z.array(MatchDetailPlayerSchema).optional(),
  // Rush only. Room ids for the 7 slots of this map, T castle first. See MatchDetail.rushRooms
  rushRooms: RushRoomsSchema.optional(),
})
export type MatchMap = z.infer<typeof MatchMapSchema>

// Accept step as seen by a participant
export const MatchAcceptViewSchema = z.object({
  // Epoch ms
  deadline: z.number(),
  windowSec: z.number().int().positive(),
  accepted: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  // True once the viewer accepted or declined
  responded: z.boolean(),
})
export type MatchAcceptView = z.infer<typeof MatchAcceptViewSchema>

// Veto as seen by one team. Votes are hidden while the other team acts
export const MatchVetoViewSchema = z.object({
  state: VetoStateSchema,
  // Epoch ms. null once the veto is done
  stepDeadline: z.number().nullable(),
})
export type MatchVetoView = z.infer<typeof MatchVetoViewSchema>

export const MatchDetailSchema = z.object({
  id: UuidSchema,
  // Human room id such as brave-amber-falcon. Older matches have none
  slug: z.string().optional(),
  mode: ModeSchema,
  mapId: z.string().nullable(),
  status: MatchStatusSchema,
  // null until a server is allocated
  driver: ServerDriverNameSchema.nullable(),
  startedAt: IsoDateSchema.nullable(),
  endedAt: IsoDateSchema.nullable(),
  teams: z.array(MatchDetailTeamSchema),
  // round.arena carries the room each round was played in
  rounds: z.array(MatchRoundSchema),
  // Rush only. The 7 rooms of a single map match, from match_started. Left out until the server reports them
  rushRooms: RushRoomsSchema.optional(),
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
  // Best of for the whole match. Left out or 1 for a single map
  bestOf: z.number().int().positive().optional(),
  // One entry per map. In a series teams[].score is maps won and player stats are totals
  maps: z.array(MatchMapSchema).optional(),
  // Participants only, while the match is in that step
  accept: MatchAcceptViewSchema.optional(),
  veto: MatchVetoViewSchema.optional(),
  warmup: z.object({ connected: z.number().int().nonnegative(), expected: z.number().int().nonnegative() }).optional(),
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
