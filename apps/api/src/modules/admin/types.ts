import type { FastifyRequest } from "fastify"
import type { PgDatabase } from "drizzle-orm/pg-core"
import type { AdminEventKind, Mode, TrustLevel } from "@rushsite/shared"

export type { AdminEventKind, Mode, TrustLevel }

// Any drizzle postgres database, node-postgres, postgres-js or PGlite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>

// Hook inputs accept any of these and responses always carry ISO strings.
export type Timestamp = Date | string | number

// Hook shapes the api supplies

// One live ticket from the Redis queue state. Matches LiveTicket in modules/queue/service.ts.
export interface QueueTicketSnapshot {
  id: string
  partyId: string
  modes: Mode[]
  steamIds: string[]
  ratings: Partial<Record<Mode, number>>
  region: string
  // Epoch ms or ISO
  enqueuedAt: Timestamp
}

export interface HostServerSnapshot {
  slotIndex: number
  port: number | null
  status: string
  matchId: string | null
}

export interface HostSnapshot {
  id: string
  name: string
  publicIp: string | null
  status: string
  cs2Version: string | null
  updating: boolean
  slots: { total: number; free: number }
  lastSeenAt: Timestamp | null
  servers?: HostServerSnapshot[]
}

// A recent webhook received from a match plugin, or an error the api recorded.
export interface RecentEventSnapshot {
  id: string
  kind: "webhook" | "error"
  at: Timestamp
  // Webhook event type such as match_end, or an error code
  type: string
  message: string
  matchId?: string | null
  // false for a rejected webhook, such as a bad signature
  ok?: boolean
  detail?: unknown
}

// Minimal Redis surface the plugin uses. ioredis satisfies it.
export interface RedisLike {
  ping(): Promise<string>
}

export interface AdminPluginOptions {
  db: Db
  redis: RedisLike
  // True when the SteamID64 is listed in ADMIN_STEAM_IDS.
  isAdmin(steamId: string): boolean
  // Returns the signed in user's SteamID64 or null.
  authenticate(request: FastifyRequest): Promise<string | null>
  // Every waiting ticket across all modes.
  getQueueSnapshot(): Promise<QueueTicketSnapshot[]>
  getHosts(): Promise<HostSnapshot[]>
  // Removes the ticket from every mode and tells its party. False when the ticket is gone.
  removeTicket(ticketId: string): Promise<boolean>
  // Cancels without rating changes, frees the server and requeues nobody. False when not found or already over.
  cancelMatch(matchId: string, reason: string): Promise<boolean>
  // Sets the level and locks it so automatic evaluation leaves it alone.
  setTrustLevel(steamId: string, level: TrustLevel): Promise<void>
  // Null until means permanent. Also drops the user from the queue.
  ban(steamId: string, reason: string, until?: Date | null): Promise<void>
  // Revokes every active ban. False when there was none.
  unban(steamId: string): Promise<boolean>
  // Newest first.
  recentEvents(limit: number): Promise<RecentEventSnapshot[]>
  // Sends an admin_event WS message to connected admins.
  emitAdmin(kind: AdminEventKind, payload: unknown): void
  now?: () => Date
}

// Response shapes. apps/web/src/app/admin/_lib/types.ts mirrors these.

export interface UserCard {
  steamId: string
  displayName: string
  avatarUrl: string | null
}

export interface QueueTicketView {
  id: string
  partyId: string
  modes: Mode[]
  size: number
  players: UserCard[]
  // Party mean rating for this mode
  rating: number | null
  region: string
  enqueuedAt: string
  waitSec: number
}

export interface QueueModeView {
  mode: Mode
  players: number
  tickets: QueueTicketView[]
}

export interface QueueView {
  generatedAt: string
  modes: QueueModeView[]
  totalTickets: number
  totalPlayers: number
}

export interface MatchPlayerView extends UserCard {
  team: number
  accepted: boolean | null
  connected: boolean | null
  abandoned: boolean | null
  won: boolean | null
  kills: number | null
  deaths: number | null
  headshots: number | null
  damage: number | null
}

export interface MatchSummaryView {
  id: string
  mode: Mode
  status: string
  source: string
  region: string
  teams: { name: string; players: UserCard[] }[]
  mapId: string | null
  hostId: string | null
  server: { ip: string; port: number; connect: string | null } | null
  winnerTeam: string | null
  score: Record<string, number> | null
  tournamentId: string | null
  cancelReason: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface MatchDetailView extends MatchSummaryView {
  maps: string[] | null
  acceptDeadline: string | null
  readyAt: string | null
  players: MatchPlayerView[]
  rounds: { round: number; winnerTeam: string; score: Record<string, number>; arena: string | null }[]
}

export interface HostView {
  id: string
  name: string
  publicIp: string | null
  status: string
  cs2Version: string | null
  updating: boolean
  slots: { total: number; free: number; used: number }
  lastSeenAt: string | null
  servers: HostServerSnapshot[]
}

export interface EventView {
  id: string
  kind: "webhook" | "error"
  at: string
  type: string
  message: string
  matchId: string | null
  ok: boolean
  detail: unknown
}

export interface AuditEntry {
  id: string
  adminSteamId: string
  action: AuditAction
  target: string
  payload: unknown
  createdAt: string
}

export type AuditAction = "queue.remove" | "match.cancel" | "user.ban" | "user.unban" | "user.trust"

export interface BanView {
  id: string
  reason: string
  bannedBy: string | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  active: boolean
}

export interface TrustSignalView {
  id: string
  source: string
  clean: boolean
  data: unknown
  fetchedAt: string
}

export interface RatingView {
  mode: Mode
  rating: number
  rd: number
  matchesPlayed: number
  wins: number
  losses: number
  updatedAt: string
}

export interface UserMatchView {
  id: string
  mode: Mode
  status: string
  team: number
  won: boolean | null
  abandoned: boolean
  kills: number | null
  deaths: number | null
  headshots: number | null
  score: Record<string, number> | null
  mapId: string | null
  createdAt: string
}

export interface UserDetailView {
  user: UserCard & {
    region: string
    countryCode: string | null
    profileUrl: string | null
    createdAt: string
    lastLoginAt: string
  }
  steam: {
    personaName: string
    accountCreatedAt: string | null
    cs2PlaytimeMinutes: number | null
    communityVisibility: number | null
    fetchedAt: string
  } | null
  trust: { level: TrustLevel; reason: string; locked: boolean; updatedAt: string } | null
  trustSignals: TrustSignalView[]
  ratings: RatingView[]
  recentMatches: UserMatchView[]
  bans: BanView[]
  activeBan: BanView | null
  cooldowns: { reason: string; endsAt: string; offence: number }[]
  reports: { received: number; open: number }
  flags: { open: number; total: number }
  audit: AuditEntry[]
}

export interface Health {
  ok: boolean
  latencyMs: number | null
  error?: string
}

export interface OverviewView {
  generatedAt: string
  queue: { mode: Mode; tickets: number; players: number; longestWaitSec: number }[]
  matches: { active: number; byStatus: Record<string, number>; finished24h: number; abandoned24h: number }
  hosts: { total: number; online: number; updating: number; slotsTotal: number; slotsFree: number }
  users: { total: number; new24h: number }
  moderation: { activeBans: number; openReports: number; openFlags: number }
  events: { errorsLastHour: number; webhooksLastHour: number; failedWebhooksLastHour: number }
  health: { db: Health; redis: Health; queue: Health; matches: Health; hosts: Health; events: Health }
}
