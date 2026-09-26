import type { FastifyRequest } from "fastify"
import type { PgDatabase } from "drizzle-orm/pg-core"
import type {
  AdminEventKind,
  Announcement,
  ChatMuteStatus,
  ChatMuteView,
  FeatureFlag,
  MetricsRange,
  MapLoadout,
  MetricsView,
  Mode,
  PoolMap,
  PoolMode,
  PoolView,
  TrustLevel,
  WorkshopItem,
} from "@rushsite/shared"

export type { AdminEventKind, Announcement, ChatMuteStatus, ChatMuteView, FeatureFlag, MetricsRange, MetricsView, Mode, TrustLevel }

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

// Flag store. FlagService in modules/flags satisfies it.
export interface FlagsLike {
  list(): Promise<FeatureFlag[]>
  get(key: string): Promise<FeatureFlag | null>
  set(key: string, enabled: boolean, value: unknown, by: string | null): Promise<{ flag: FeatureFlag; before: FeatureFlag | null }>
  remove(key: string): Promise<FeatureFlag | null>
}

export interface AnnouncementWrite {
  text: string
  level: "info" | "warn"
  startsAt: Date
  endsAt: Date | null
  dismissible: boolean
}

// Announcement store. AnnouncementService in modules/flags satisfies it.
export interface AnnouncementsLike {
  list(limit?: number): Promise<Announcement[]>
  get(id: string): Promise<Announcement | null>
  create(input: AnnouncementWrite, by: string | null): Promise<Announcement>
  update(id: string, patch: Partial<AnnouncementWrite>): Promise<Announcement | null>
  remove(id: string): Promise<Announcement | null>
}

// Chat moderation. ChatService in modules/chat satisfies it.
export interface ChatModerationLike {
  // Null when the message is missing or already removed
  remove(id: string, by: string): Promise<{ id: string; channel: string; steamId: string; body: string } | null>
  // Null until is permanent
  mute(steamId: string, until: Date | null, reason: string, by: string): Promise<ChatMuteStatus>
  // False when there was no active mute
  unmute(steamId: string): Promise<boolean>
  mutes(): Promise<ChatMuteView[]>
}

// Live aim map pool. MapPoolService in modules/maps satisfies it
export interface MapPoolLike {
  view(): Promise<PoolView>
  add(
    input: { id: string; displayName: string; mapName?: string; modes: PoolMode[]; loadout?: MapLoadout; workshop: WorkshopItem },
    by: string,
  ): Promise<PoolMap>
  update(
    id: string,
    patch: { displayName?: string; modes?: PoolMode[]; loadout?: MapLoadout | null },
    by: string,
  ): Promise<{ before: PoolMap; after: PoolMap }>
  reorder(ids: string[], by: string): Promise<PoolMap[]>
  remove(id: string, by: string): Promise<PoolMap>
}

export interface AdminPluginOptions {
  db: Db
  redis: RedisLike
  // True for ADMIN_STEAM_IDS and for rows in the admins table. Answers from a cache.
  isAdmin(steamId: string): boolean
  // Editable admin list. The /admin/admins routes answer 404 without it
  admins?: AdminDirectory
  // Steam names and avatars for ids with no user row. Missing ids are unknown to Steam
  steamProfiles?(steamIds: string[]): Promise<SteamProfileCard[]>
  // Moves the user's open sockets in or out of the admin audience on every instance
  onAdminChanged?(steamId: string, isAdmin: boolean): void
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
  // Admin ops. Routes that need a missing one answer 404.
  flags?: FlagsLike
  announcements?: AnnouncementsLike
  chat?: ChatModerationLike
  // Defaults to reading metric_samples from db
  metrics?(range: MetricsRange, now: Date): Promise<MetricsView>
  // Pulls every waiting ticket out of a mode that was just closed. Returns how many tickets it touched
  onModeClosed?(mode: Mode): Promise<number>
  // Pushes the new mode availability to every client after a queue flag changes
  onQueueFlagChanged?(): Promise<unknown>
  // Turns a /id/<vanity> profile URL into a SteamID64. Null when unknown or Steam is not configured
  resolveVanity?(vanity: string): Promise<string | null>
  // Map pool routes answer 404 without these
  mapPool?: MapPoolLike
  // Reads a Workshop item from Steam
  fetchWorkshop?(workshopId: string): Promise<WorkshopItem>
  // Pushes a fresh queue status to the player, for example after a cooldown was cleared
  notifyQueueStatus?(steamId: string): Promise<void>
  // Discord link routes answer 404 without it
  discord?: DiscordLike
  // True when S3 demo storage is configured. Shown next to the demo recording setting
  demoStorageConfigured?: boolean
  now?: () => Date
}

export interface DiscordLinkAdminView {
  discordId: string
  username: string
  globalName: string | null
  avatarUrl: string | null
  discordCreatedAt: string
  linkedAt: string
  roleGranted: boolean
  syncedAt: string | null
  syncError: string | null
}

// DiscordService in src/modules/discord/service.ts satisfies it.
export interface DiscordLike {
  readonly enabled: boolean
  linkOf(steamId: string): Promise<DiscordLinkAdminView | null>
  unlink(steamId: string): Promise<boolean>
  sync(steamId: string): Promise<DiscordLinkAdminView | null>
}

export interface AdminRow {
  steamId: string
  addedBy: string
  note: string | null
  createdAt: Date
}

export interface SteamProfileCard {
  steamId: string
  displayName: string
  avatarUrl: string | null
  profileUrl: string | null
}

// AdminRegistry in src/lib/admins.ts satisfies it.
export interface AdminDirectory {
  // ADMIN_STEAM_IDS. These cannot be removed through the api
  rootIds(): string[]
  // Reloads the cache when it is stale so isAdmin sees admins added on other instances
  ensureFresh(): Promise<void>
  list(): Promise<AdminRow[]>
  // Null when the id already has a row
  grant(steamId: string, addedBy: string, note: string | null): Promise<AdminRow | null>
  // Null when there was no row
  revoke(steamId: string): Promise<AdminRow | null>
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
  // Filled on the user page. Null when the admin has no user row
  adminName?: string | null
  action: AuditAction
  target: string
  payload: unknown
  createdAt: string
}

export type AuditAction =
  | "queue.remove"
  | "match.cancel"
  | "user.ban"
  | "user.unban"
  | "user.trust"
  | "user.cooldown_clear"
  | "user.discord_unlink"
  | "user.discord_sync"
  | "flag.set"
  | "flag.delete"
  | "announcement.create"
  | "announcement.update"
  | "announcement.delete"
  | "admin.grant"
  | "admin.revoke"
  | "chat.delete"
  | "chat.mute"
  | "chat.unmute"
  // Written by the chat filter with adminSteamId system
  | "chat.refused"
  | "map.add"
  | "map.update"
  | "map.reorder"
  | "map.remove"
  | "gslt.add"
  | "gslt.update"
  | "gslt.remove"
  | "demo_recording.set"

export type GsltStatus = "free" | "in_use" | "invalid"

// A pool token. The token itself is masked and never leaves the api in full
export interface GsltView {
  id: string
  token: string
  memo: string | null
  status: GsltStatus
  matchId: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface AdminView {
  steamId: string
  displayName?: string
  avatarUrl?: string
  // True when the name comes from a user row rather than Steam
  signedIn: boolean
  // Super admins come from ADMIN_STEAM_IDS and cannot be removed
  super: boolean
  source: "config" | "db"
  addedBy?: string
  addedByName?: string
  note?: string
  createdAt?: string
}

export interface AdminListView {
  admins: AdminView[]
  viewer: { steamId: string; super: boolean; canManage: boolean }
}

// Preview of a SteamID64 before it is made an admin
export interface AdminCandidateView {
  steamId: string
  displayName?: string
  avatarUrl?: string
  profileUrl?: string
  signedIn: boolean
  // Null when the id is not an admin yet
  admin: "super" | "admin" | null
}

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
  slug: string | null
  bestOf: number | null
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
  // Live queue ticket or active match. The routes fill it
  state: UserStateView
  audit: AuditEntry[]
}

export interface UserStateView {
  queue: { ticketId: string; partyId: string; modes: Mode[]; enqueuedAt: string } | null
  match: ActiveMatchRef | null
}

export interface ActiveMatchRef {
  id: string
  slug: string | null
  mode: Mode
  status: string
  createdAt: string
}

// One row of the admin name search
export interface UserSearchHit extends UserCard {
  createdAt: string
  lastLoginAt: string
  trustLevel: TrustLevel | null
  banned: boolean
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
