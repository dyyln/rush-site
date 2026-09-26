import { createFaceitClient } from "@rushsite/faceit"
import { BRAND_NAME, CHAT_SLOW_MODE_FLAG, type ServerDriver } from "@rushsite/shared"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "./db/client.js"
import { disabledModes, type Env } from "./env.js"
import { AdminRegistry } from "./lib/admins.js"
import { ActivityService } from "./modules/activity/service.js"
import type { Rng } from "./lib/clock.js"
import { EventLog } from "./lib/event-log.js"
import { SnapshotStore, withSnapshots } from "./lib/snapshots.js"
import { makeAuthenticator, SessionStore, type Authenticator } from "./modules/auth/session.js"
import { ChatService, slowModeSeconds } from "./modules/chat/service.js"
import { DiscordRestApi, type DiscordApi } from "./modules/discord/client.js"
import { discordRedirectUri } from "./modules/discord/routes.js"
import { DiscordService } from "./modules/discord/service.js"
import { SteamWebApi, type FetchFn } from "./modules/auth/steam.js"
import { UsersService } from "./modules/auth/users.js"
import { AnnouncementService, FlagService } from "./modules/flags/service.js"
import { FriendsService } from "./modules/friends/service.js"
import { PresenceService } from "./modules/friends/presence.js"
import { HttpAgentClient, type AgentApi } from "./modules/match/agent.js"
import { Allocator } from "./modules/match/allocator.js"
import { MapPoolService } from "./modules/maps/pool.js"
import { MatchFlow } from "./modules/match/flow.js"
import { MatchWatchdog } from "./modules/match/watchdog.js"
import { createDemoStorage, type DemoStorage } from "./modules/match/storage.js"
import { PartyService } from "./modules/parties/service.js"
import { CooldownService } from "./modules/queue/cooldowns.js"
import { QueueService } from "./modules/queue/service.js"
import { RatingService } from "./modules/rating/service.js"
import { BanGate } from "./modules/trust/ban-gate.js"
import { BanService } from "./modules/trust/bans.js"
import { TrustService, type FaceitLookup } from "./modules/trust/service.js"
import { disconnectUsers, type Notifier } from "./modules/ws/hub.js"

export type AppContext = {
  env: Env
  db: Db
  redis: Redis
  notifier: Notifier
  log: FastifyBaseLogger
  now: () => number
  fetch: FetchFn
  events: EventLog
  sessions: SessionStore
  auth: Authenticator
  banGate: BanGate
  // Closes the user's open sockets on every instance
  disconnectUser: (steamId: string, reason: string) => void
  isAdmin: (steamId: string) => boolean
  admins: AdminRegistry
  steam: SteamWebApi
  users: UsersService
  trust: TrustService
  bans: BanService
  ratings: RatingService
  parties: PartyService
  cooldowns: CooldownService
  queue: QueueService
  allocator: Allocator
  flow: MatchFlow
  storage: DemoStorage
  presence: PresenceService
  activity: ActivityService
  // Undefined without FACEIT_API_KEY
  faceit: FaceitLookup | undefined
  discord: DiscordService
  friends: FriendsService
  snapshots: SnapshotStore
  flags: FlagService
  announcements: AnnouncementService
  chat: ChatService
  maps: MapPoolService
}

export type ContextDeps = {
  env: Env
  db: Db
  redis: Redis
  notifier: Notifier
  log: FastifyBaseLogger
  now?: () => number
  rng?: Rng
  fetch?: FetchFn
  agent?: AgentApi
  storage?: DemoStorage
  faceit?: FaceitLookup | null
  surgeDriver?: ServerDriver | null
  // Null turns Discord off. Unset builds the REST client from env
  discordApi?: DiscordApi | null
}

function discordApiFrom(env: Env, fetchFn: FetchFn): DiscordApi | null {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_LINKED_ROLE_ID } = env
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_LINKED_ROLE_ID) return null
  return new DiscordRestApi(
    {
      clientId: DISCORD_CLIENT_ID,
      clientSecret: DISCORD_CLIENT_SECRET,
      botToken: DISCORD_BOT_TOKEN,
      guildId: DISCORD_GUILD_ID,
      roleId: DISCORD_LINKED_ROLE_ID,
      redirectUri: discordRedirectUri(env.API_PUBLIC_URL),
    },
    fetchFn,
  )
}

export function buildContext(deps: ContextDeps): AppContext {
  const { env, db, redis, log } = deps
  const now = deps.now ?? Date.now
  const snapshots = new SnapshotStore(redis, now)
  const notifier = withSnapshots(deps.notifier, snapshots, (err) => log.warn({ err }, "snapshot write failed"))
  const fetchFn = deps.fetch ?? fetch
  const sessions = new SessionStore(redis, env.SESSION_TTL_DAYS * 86400)
  const admins = new AdminRegistry(db, env.ADMIN_STEAM_IDS, log)
  void admins.refresh().catch(() => undefined)
  const maps = new MapPoolService(db, log)
  void maps.refresh().catch(() => undefined)
  const steam = new SteamWebApi(env.STEAM_API_KEY, fetchFn)
  const users = new UsersService(db)
  let faceit: FaceitLookup | undefined
  if (deps.faceit !== undefined) {
    faceit = deps.faceit ?? undefined
  } else if (env.FACEIT_API_KEY) {
    const client = createFaceitClient({ apiKey: env.FACEIT_API_KEY })
    faceit = (id) => client.lookupBySteamId(id)
  } else {
    log.warn("FACEIT_API_KEY not set. FACEIT counts as neutral for every player")
  }
  if (!env.STEAM_API_KEY) log.warn("STEAM_API_KEY not set. Profiles, friends and Steam ban checks are disabled")
  const trust = new TrustService(
    db,
    steam,
    faceit,
    {
      verifiedMinMatches: env.TRUST_VERIFIED_MIN_MATCHES,
      trustedMinMatches: env.TRUST_TRUSTED_MIN_MATCHES,
      trustedMinAccountDays: env.TRUST_TRUSTED_MIN_ACCOUNT_DAYS,
      banGraceDays: env.TRUST_BAN_GRACE_DAYS,
      requireSteamCheck: env.NODE_ENV === "production",
    },
    log,
    now,
  )
  const ratings = new RatingService(db, now)
  const parties = new PartyService(db, users, notifier)
  const cooldowns = new CooldownService(db, now)
  const allowUnresolvedModes = env.NODE_ENV !== "production" && env.ALLOW_UNRESOLVED_MODES
  const queue = new QueueService(db, redis, notifier, parties, cooldowns, ratings, trust, now, {
    allowUnresolvedModes,
    disabledModes: disabledModes(env),
  })
  const storage = deps.storage ?? createDemoStorage(env)
  const agent = deps.agent ?? new HttpAgentClient(env.RUSHSITE_AGENT_TOKEN, fetchFn)
  const allocator = new Allocator(
    db,
    agent,
    storage,
    {
      webhookBaseUrl: env.API_PUBLIC_URL,
      surgeWaitSec: env.SURGE_WAIT_SEC,
      brand: { name: BRAND_NAME, siteUrl: env.PUBLIC_URL },
    },
    log,
    deps.surgeDriver ?? null,
  )
  const events = new EventLog(redis, notifier)
  const watchdog = new MatchWatchdog({
    db,
    redis,
    allocator,
    agent,
    log,
    now,
    options: {
      maxDurationMin: {
        aim1v1: env.MATCH_MAX_MIN_AIM,
        aim2v2: env.MATCH_MAX_MIN_AIM,
        rush3v3: env.MATCH_MAX_MIN_RUSH,
        rush1v1: env.MATCH_MAX_MIN_RUSH,
        rush2v2: env.MATCH_MAX_MIN_RUSH,
      },
      silenceSec: env.MATCH_SILENCE_SEC,
      intervalSec: env.WATCHDOG_INTERVAL_SEC,
    },
  })
  const activity = new ActivityService(db, log, now)
  queue.setActivity(activity)
  const flow = new MatchFlow({
    activity,
    db,
    redis,
    notifier,
    queue,
    cooldowns,
    ratings,
    trust,
    allocator,
    log,
    events,
    watchdog,
    maps,
    now,
    ...(deps.rng ? { rng: deps.rng } : {}),
    options: {
      allocationTimeoutSec: env.ALLOCATION_TIMEOUT_SEC,
      connectTimeoutSec: env.CONNECT_TIMEOUT_SEC,
      demoWaitSec: env.DEMO_WAIT_SEC,
      allowUnresolvedModes,
      ...(env.RUSH_ROOM_VETO !== undefined ? { rushRoomVeto: env.RUSH_ROOM_VETO } : {}),
    },
  })
  const presence = new PresenceService({ db, redis, notifier, queue, parties, log, now })
  const friends = new FriendsService({ db, redis, notifier, steam, users, parties, log, now, presence })
  parties.setPresence(presence)
  queue.onPlayersChanged((ids) => presence.refresh(ids))
  flow.onPlayersChanged((ids) => presence.refresh(ids))
  flow.onMatchChanged((m) => presence.matchChanged(m))
  flow.onResult(async (r) => presence.refresh((await flow.playersOf(r.matchId)).map((p) => p.steamId)))
  flow.onResult(async (r) => activity.onMatchResult(r))
  const banGate = new BanGate(db, redis, now)
  const disconnectUser = (steamId: string, reason: string) => disconnectUsers(notifier, [steamId], reason)
  const flags = new FlagService(db, now)
  queue.setModeGate((mode) => flags.queueOpen(mode))
  const discordApi = deps.discordApi !== undefined ? deps.discordApi : discordApiFrom(env, fetchFn)
  const discord = new DiscordService({
    db,
    api: discordApi,
    inviteUrl: env.DISCORD_INVITE_URL ?? null,
    isBanned: async (id) => (await banGate.lookup(id)) !== null,
    activity,
    log,
    now,
  })
  const bans = new BanService(db, ratings, trust, queue, parties, sessions, now, env.ROLLBACK_WINDOW_DAYS, banGate, disconnectUser, (id) =>
    discord.syncQuietly(id),
  )
  return {
    env,
    db,
    redis,
    notifier,
    log,
    now,
    fetch: fetchFn,
    events,
    sessions,
    auth: makeAuthenticator(sessions, (id) => banGate.cached(id)),
    banGate,
    disconnectUser,
    isAdmin: (id) => admins.isAdmin(id),
    admins,
    steam,
    users,
    trust,
    bans,
    ratings,
    parties,
    cooldowns,
    queue,
    allocator,
    flow,
    storage,
    presence,
    activity,
    faceit,
    discord,
    friends,
    snapshots,
    flags,
    announcements: new AnnouncementService(db, now),
    chat: new ChatService({
      db,
      redis,
      notifier,
      isAdmin: (id) => admins.isAdmin(id),
      now,
      slowModeSec: async () => slowModeSeconds(await flags.get(CHAT_SLOW_MODE_FLAG)),
    }),
    maps,
  }
}
