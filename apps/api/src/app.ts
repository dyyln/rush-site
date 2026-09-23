import cookie from "@fastify/cookie"
import cors from "@fastify/cors"
import websocket from "@fastify/websocket"
import { MODES, type Mode, type TrustLevel } from "@rushsite/shared"
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify"
import { buildContext, type AppContext, type ContextDeps } from "./context.js"
import { realtimeMetrics } from "./lib/backpressure.js"
import { ApiError } from "./lib/errors.js"
import type { AdminEventKind } from "./lib/event-log.js"
import { withLock } from "./lib/redis.js"
import { registerAuthRoutes } from "./modules/auth/routes.js"
import challengesPlugin from "./modules/challenges/index.js"
import friendsPlugin from "./modules/friends/index.js"
import { createSurgeDriver } from "./modules/match/dathost.js"
import { registerMatchRoutes } from "./modules/match/routes.js"
import { registerPartyRoutes } from "./modules/parties/routes.js"
import { matchmakeAll } from "./modules/queue/loop.js"
import { LoopMetrics } from "./modules/queue/metrics.js"
import { registerQueueRoutes } from "./modules/queue/routes.js"
import type { LiveTicket } from "./modules/queue/service.js"
import { registerStatsFeatures } from "./modules/stats/features.js"
import { modeStats, registerStatsRoutes } from "./modules/stats/routes.js"
import { LocalHub, type Audience } from "./modules/ws/hub.js"
import { registerWsRoutes } from "./modules/ws/routes.js"

export type BuildAppOptions = Omit<ContextDeps, "log"> & {
  hub?: LocalHub
  logger?: FastifyServerOptions["logger"]
  // Tournament and admin plugins are optional and loaded if present
  plugins?: { tournaments?: boolean; admin?: boolean }
}

export type App = { app: FastifyInstance; ctx: AppContext; hub: LocalHub }

// Loads an optional sibling module. Missing modules are skipped so the api still boots
async function optionalPlugin(app: FastifyInstance, spec: string): Promise<unknown | null> {
  try {
    const mod = (await import(spec)) as { default?: unknown }
    return mod.default ?? null
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|Failed to load url/.test(String(err))) {
      app.log.warn({ spec }, "optional plugin not found, skipping")
      return null
    }
    throw err
  }
}

export async function buildApp(opts: BuildAppOptions): Promise<App> {
  const app = Fastify({
    logger: opts.logger ?? { level: opts.env.LOG_LEVEL },
    trustProxy: true,
  })
  const ctx = buildContext({ ...opts, log: app.log })
  if (opts.surgeDriver === undefined) ctx.allocator.setSurgeDriver(createSurgeDriver(opts.env, ctx.db, app.log))
  const hub = opts.hub ?? new LocalHub()
  const loopMetrics = new LoopMetrics(app.log)

  await app.register(cookie, { secret: opts.env.SESSION_SECRET })
  // The default method list leaves out DELETE, which kick, unfriend and cancel routes use
  await app.register(cors, { origin: [opts.env.PUBLIC_URL], credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] })
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) })
    }
    const status = (err as { statusCode?: number }).statusCode
    if (status && status < 500) {
      const code = (err as { code?: string }).code ?? "bad_request"
      return reply.code(status).send({ error: code.toLowerCase(), message: (err as Error).message })
    }
    req.log.error({ err }, "unhandled error")
    ctx.events.record({ kind: "error", type: "http_500", message: (err as Error).message, detail: { url: req.url } })
    return reply.code(500).send({ error: "internal" })
  })

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "not_found", message: `${req.method} ${req.url} not found` }),
  )

  app.get("/health", async () => {
    await ctx.redis.ping()
    return {
      ok: true,
      ws: { users: hub.connectedUsers(), ...realtimeMetrics },
      loops: loopMetrics.snapshot(["matchmaker", "refresh"]),
    }
  })

  registerAuthRoutes(app, ctx)
  registerPartyRoutes(app, ctx)
  registerQueueRoutes(app, ctx)
  registerMatchRoutes(app, ctx)
  registerStatsRoutes(app, ctx)
  registerStatsFeatures(app, ctx)
  registerWsRoutes(app, ctx, hub)
  await app.register(challengesPlugin, { ctx, scheduler: !opts.env.DISABLE_LOOPS })
  await app.register(friendsPlugin, { ctx, scheduler: !opts.env.DISABLE_LOOPS })

  if (opts.plugins?.tournaments !== false) {
    const tournamentsPlugin = await optionalPlugin(app, "./modules/tournaments/index.js")
    if (tournamentsPlugin) {
      await app.register(tournamentsPlugin as Parameters<FastifyInstance["register"]>[0], {
        db: ctx.db,
        startMatch: (params: Parameters<AppContext["flow"]["createTournamentMatch"]>[0]) => ctx.flow.createTournamentMatch(params),
        onMatchResult: (handler: Parameters<AppContext["flow"]["onResult"]>[0]) => ctx.flow.onResult(handler),
        emit: (message: { type: string; payload: unknown; ts: number }, audience?: Audience) =>
          ctx.notifier.send(audience ?? { kind: "broadcast" }, message),
        authenticate: ctx.auth,
        getTrustLevels: (ids: string[]) => ctx.trust.levels(ids),
        getRatings: (ids: string[], mode: Mode) => ctx.ratings.ratingValues(ids, mode),
        getParty: (steamId: string) => ctx.parties.partyOf(steamId),
        getProfiles: async (ids: string[]) => {
          const cards = await ctx.users.cards(ids)
          return Object.fromEntries(
            ids.map((id) => [id, { displayName: cards.get(id)?.displayName ?? id, avatarUrl: cards.get(id)?.avatarUrl ?? null }]),
          )
        },
        scheduler: !opts.env.DISABLE_LOOPS,
      })
    }
  }

  if (opts.plugins?.admin !== false) {
    const adminPlugin = await optionalPlugin(app, "./modules/admin/index.js")
    if (adminPlugin) await app.register(adminPlugin as Parameters<FastifyInstance["register"]>[0], adminOptions(ctx))
  }

  if (!opts.env.DISABLE_LOOPS) startLoops(app, ctx, loopMetrics)
  return { app, ctx, hub }
}

async function queueSnapshot(ctx: AppContext): Promise<LiveTicket[]> {
  const seen = new Map<string, LiveTicket>()
  for (const mode of MODES) for (const t of await ctx.queue.waiting(mode)) seen.set(t.id, t)
  return [...seen.values()]
}

export function adminOptions(ctx: AppContext) {
  return {
    db: ctx.db,
    redis: ctx.redis,
    isAdmin: ctx.isAdmin,
    authenticate: ctx.auth,
    getQueueSnapshot: () => queueSnapshot(ctx),
    getActiveMatches: async () => {
      const ms = await ctx.flow.activeMatches()
      return Promise.all(
        ms.map(async (m) => {
          const players = await ctx.flow.playersOf(m.id)
          return {
            id: m.id,
            mode: m.mode,
            status: m.status,
            source: m.source,
            region: m.region,
            teams: m.teams,
            mapId: m.mapId,
            hostId: m.hostId,
            serverIp: m.serverIp,
            serverPort: m.serverPort,
            connect: m.connect,
            createdAt: m.createdAt,
            startedAt: m.startedAt,
            acceptDeadline: m.acceptDeadline,
            tournamentId: m.tournamentId,
            players: players.map((p) => ({ steamId: p.steamId, accepted: p.accepted, connected: p.connected })),
          }
        }),
      )
    },
    getHosts: async () => {
      const hosts = await ctx.allocator.hostsWithSlots()
      return hosts.map((h) => ({
        id: h.id,
        name: h.name,
        agentUrl: h.agentUrl,
        publicIp: h.publicIp,
        status: h.status,
        cs2Version: h.cs2Version,
        updating: h.status === "updating",
        slots: { total: h.slots.length, free: h.slots.filter((s) => s.status === "free").length },
        lastSeenAt: h.lastSeenAt,
        servers: h.slots.map((s) => ({ slotIndex: s.slotIndex, port: s.port, status: s.status, matchId: s.matchId })),
      }))
    },
    removeTicket: async (ticketId: string) => {
      const t = await ctx.queue.ticket(ticketId)
      if (!t) return false
      await ctx.queue.cancelParty(t.partyId, "admin_removed")
      return true
    },
    cancelMatch: (matchId: string, reason: string) => ctx.flow.cancelMatch(matchId, reason, { requeue: false }),
    setTrustLevel: (steamId: string, level: TrustLevel) => ctx.bans.setTrustLevel(steamId, level),
    ban: async (steamId: string, reason: string, until?: Date | null) => {
      await ctx.bans.ban(steamId, reason, until ? { until } : {})
    },
    unban: async (steamId: string) => (await ctx.bans.unban(steamId)) > 0,
    recentEvents: (limit: number) => ctx.events.recent(limit),
    emitAdmin: (kind: AdminEventKind, payload: unknown) => ctx.events.emit(kind, payload),
  }
}

// Background loops. Redis locks keep one instance doing each job
function startLoops(app: FastifyInstance, ctx: AppContext, metrics: LoopMetrics): void {
  const timers: NodeJS.Timeout[] = []
  const loop = (name: string, everyMs: number, fn: (lockTtlMs: number) => Promise<unknown>, lockTtlMs?: number) => {
    let running = false
    const ttl = lockTtlMs ?? Math.max(everyMs * 5, 10_000)
    const run = async () => {
      if (running) return
      running = true
      try {
        await withLock(ctx.redis, `lock:${name}`, ttl, () => fn(ttl))
      } catch (err) {
        app.log.error({ err, loop: name }, "loop failed")
        ctx.events.record({ kind: "error", type: `loop_${name}`, message: (err as Error).message })
      } finally {
        running = false
      }
    }
    timers.push(setInterval(run, everyMs))
    void run()
  }
  app.addHook("onReady", async () => {
    await ctx.allocator.seedGslt(ctx.env.GSLT_TOKENS)
    let tick = 0
    loop("matchmaker", ctx.env.MATCHMAKER_INTERVAL_MS, (ttl) =>
      metrics.time("matchmaker", ttl, () => matchmakeAll(ctx.queue, ctx.flow, ctx.now(), app.log, tick++), (ids) => ({
        created: ids.length,
      })),
    )
    // Its own loop and lock so a slow refresh never holds up matching
    loop("queue_refresh", ctx.env.MATCHMAKER_INTERVAL_MS * 3, (ttl) =>
      metrics.time("refresh", ttl, () => ctx.queue.refreshQueued(), (r) => ({ ...r })),
    )
    // Timers touch only Postgres. Agent and DatHost calls live in the allocation loop
    loop("match_tick", ctx.env.MATCH_TICK_INTERVAL_MS, () => ctx.flow.timersTick())
    // A pass can wait on a 15 s agent call, so the lock outlives it
    loop("match_alloc", ctx.env.ALLOCATION_TICK_INTERVAL_MS, () => ctx.flow.allocationTick(ctx.env.ALLOCATION_CONCURRENCY), 30_000)
    loop("hosts", 30_000, () => ctx.allocator.syncHosts(ctx.env.AGENT_URLS))
    // Every instance holds the last value it saw so only changes go out. The lock picks one sender
    let lastStats = ""
    loop("mode_stats", 5000, async () => {
      const stats = await modeStats(ctx)
      const key = JSON.stringify(stats)
      const prev = await ctx.redis.get("mode_stats:last")
      if (key === prev && key === lastStats) return
      lastStats = key
      await ctx.redis.set("mode_stats:last", key, "EX", 60)
      ctx.notifier.send({ kind: "broadcast" }, { type: "mode_stats", payload: stats, ts: Date.now() })
    })
  })
  app.addHook("onClose", async () => {
    for (const t of timers) clearInterval(t)
  })
}
