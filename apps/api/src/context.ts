import { createFaceitClient } from "@rushsite/faceit"
import type { ServerDriver } from "@rushsite/shared"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "./db/client.js"
import type { Env } from "./env.js"
import type { Rng } from "./lib/clock.js"
import { EventLog } from "./lib/event-log.js"
import { makeAuthenticator, SessionStore, type Authenticator } from "./modules/auth/session.js"
import { SteamWebApi, type FetchFn } from "./modules/auth/steam.js"
import { UsersService } from "./modules/auth/users.js"
import { HttpAgentClient, type AgentApi } from "./modules/match/agent.js"
import { Allocator } from "./modules/match/allocator.js"
import { MatchFlow } from "./modules/match/flow.js"
import { createDemoStorage, type DemoStorage } from "./modules/match/storage.js"
import { PartyService } from "./modules/parties/service.js"
import { CooldownService } from "./modules/queue/cooldowns.js"
import { QueueService } from "./modules/queue/service.js"
import { RatingService } from "./modules/rating/service.js"
import { BanService } from "./modules/trust/bans.js"
import { TrustService, type FaceitLookup } from "./modules/trust/service.js"
import type { Notifier } from "./modules/ws/hub.js"

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
  isAdmin: (steamId: string) => boolean
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
}

export function buildContext(deps: ContextDeps): AppContext {
  const { env, db, redis, notifier, log } = deps
  const now = deps.now ?? Date.now
  const fetchFn = deps.fetch ?? fetch
  const sessions = new SessionStore(redis, env.SESSION_TTL_DAYS * 86400)
  const admins = new Set(env.ADMIN_STEAM_IDS)
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
  const queue = new QueueService(db, redis, notifier, parties, cooldowns, ratings, trust, now, { allowUnresolvedModes })
  const storage = deps.storage ?? createDemoStorage(env)
  const allocator = new Allocator(
    db,
    deps.agent ?? new HttpAgentClient(env.RUSHSITE_AGENT_TOKEN, fetchFn),
    storage,
    { webhookBaseUrl: env.API_PUBLIC_URL, surgeWaitSec: env.SURGE_WAIT_SEC },
    log,
    deps.surgeDriver ?? null,
  )
  const events = new EventLog(redis, notifier)
  const flow = new MatchFlow({
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
    now,
    ...(deps.rng ? { rng: deps.rng } : {}),
    options: {
      allocationTimeoutSec: env.ALLOCATION_TIMEOUT_SEC,
      connectTimeoutSec: env.CONNECT_TIMEOUT_SEC,
      demoWaitSec: env.DEMO_WAIT_SEC,
      allowUnresolvedModes,
    },
  })
  const bans = new BanService(db, ratings, trust, queue, parties, sessions, now, env.ROLLBACK_WINDOW_DAYS)
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
    auth: makeAuthenticator(sessions),
    isAdmin: (id) => admins.has(id),
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
  }
}
