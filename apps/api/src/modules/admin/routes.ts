import { MODES, SteamId64Schema, TrustLevelSchema, UuidSchema } from "@rushsite/shared"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { fallbackCard, iso, type AdminStore } from "./store.js"
import type {
  AdminPluginOptions,
  AuditAction,
  EventView,
  Health,
  HostView,
  OverviewView,
  QueueTicketSnapshot,
  QueueView,
  UserCard,
  UserStateView,
} from "./types.js"

export class AdminError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code)
  }
}

const ACTIVE_STATUSES = ["accepting", "veto", "allocating", "starting", "ready", "live"]
const RECENT_STATUSES = ["finished", "abandoned", "cancelled"]
const ALL_STATUSES = [...ACTIVE_STATUSES, ...RECENT_STATUSES]
// Cap for the active list. Far above what one box can run
const ACTIVE_LIMIT = 1000
const HOUR_MS = 60 * 60 * 1000

const ReasonSchema = z.string().trim().min(1).max(500)
const CancelBody = z.object({ reason: ReasonSchema })
const RemoveBody = z.object({ reason: ReasonSchema.optional() }).optional()
const BanBody = z.object({
  reason: ReasonSchema,
  // ISO time. Null or missing is permanent
  until: z.iso.datetime({ offset: true }).nullable().optional(),
})
const TrustBody = z.object({ level: TrustLevelSchema })
const SearchQuery = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters").max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

type Hooks = Omit<AdminPluginOptions, "db" | "redis" | "isAdmin" | "admins" | "authenticate" | "now">

export interface RouteDeps {
  store: AdminStore
  hooks: Hooks
  pingRedis(): Promise<unknown>
  now(): Date
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new AdminError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
  }
  return r.data
}

function checkUuid(id: string, what: string) {
  if (!UuidSchema.safeParse(id).success) throw new AdminError(404, "not_found", `${what} not found`)
}

function checkSteamId(id: string) {
  if (!SteamId64Schema.safeParse(id).success) throw new AdminError(404, "not_found", "User not found")
}

async function timed(fn: () => Promise<unknown>): Promise<Health> {
  const start = performance.now()
  try {
    await fn()
    return { ok: true, latencyMs: Math.round(performance.now() - start) }
  } catch (err) {
    return { ok: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// Runs a hook and keeps going with a fallback if it throws, so one broken source does not blank the overview.
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<{ value: T; health: Health }> {
  let value = fallback
  const health = await timed(async () => {
    value = await fn()
  })
  return { value, health }
}

function queueView(tickets: QueueTicketSnapshot[], cards: Map<string, UserCard>, now: Date): QueueView {
  const nowMs = now.getTime()
  const modes = MODES.map((mode) => {
    const list = tickets
      .filter((t) => t.modes.includes(mode))
      .map((t) => {
        const enqueuedAt = new Date(t.enqueuedAt)
        return {
          id: t.id,
          partyId: t.partyId,
          modes: t.modes,
          size: t.steamIds.length,
          players: t.steamIds.map((id) => cards.get(id) ?? fallbackCard(id)),
          rating: t.ratings[mode] ?? null,
          region: t.region,
          enqueuedAt: enqueuedAt.toISOString(),
          waitSec: Math.max(0, Math.floor((nowMs - enqueuedAt.getTime()) / 1000)),
        }
      })
      .sort((a, b) => b.waitSec - a.waitSec)
    return { mode, players: list.reduce((n, t) => n + t.size, 0), tickets: list }
  })
  return {
    generatedAt: now.toISOString(),
    modes,
    totalTickets: tickets.length,
    totalPlayers: tickets.reduce((n, t) => n + t.steamIds.length, 0),
  }
}

function hostView(h: Awaited<ReturnType<Hooks["getHosts"]>>[number]): HostView {
  return {
    id: h.id,
    name: h.name,
    publicIp: h.publicIp,
    status: h.status,
    cs2Version: h.cs2Version,
    updating: h.updating,
    slots: { total: h.slots.total, free: h.slots.free, used: Math.max(0, h.slots.total - h.slots.free) },
    lastSeenAt: iso(h.lastSeenAt),
    servers: h.servers ?? [],
  }
}

function eventView(e: Awaited<ReturnType<Hooks["recentEvents"]>>[number]): EventView {
  return {
    id: e.id,
    kind: e.kind,
    at: iso(e.at)!,
    type: e.type,
    message: e.message,
    matchId: e.matchId ?? null,
    ok: e.ok ?? e.kind !== "error",
    detail: e.detail ?? null,
  }
}

export function registerRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
  adminOf: (req: FastifyRequest) => string,
) {
  const { store, hooks, now } = deps

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AdminError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details })
    }
    req.log.error({ err }, "admin route failed")
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "invalid_request", message: err instanceof Error ? err.message : "Bad request" })
    }
    return reply.code(500).send({ error: "internal", message: "Admin action failed" })
  })

  async function audit(req: FastifyRequest, action: AuditAction, target: string, payload: unknown) {
    return store.writeAudit({ adminSteamId: adminOf(req), action, target, payload })
  }

  async function withCards<T>(steamIds: string[], fn: (cards: Map<string, UserCard>) => T): Promise<T> {
    return fn(await store.userCards(steamIds))
  }

  const activeMatches = () => store.listMatches(ACTIVE_STATUSES, ACTIVE_LIMIT)

  app.get("/admin/overview", async (): Promise<OverviewView> => {
    const at = now()
    const nowMs = at.getTime()
    const [db, redis, queue, active, hosts, events, counts] = await Promise.all([
      timed(() => store.ping()),
      timed(() => deps.pingRedis()),
      safe(() => hooks.getQueueSnapshot(), []),
      safe(activeMatches, []),
      safe(() => hooks.getHosts(), []),
      safe(() => hooks.recentEvents(200), []),
      store.counts(at).catch(() => null),
    ])

    const byStatus: Record<string, number> = {}
    for (const m of active.value) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1

    const lastHour = events.value.filter((e) => nowMs - new Date(e.at).getTime() <= HOUR_MS)
    const webhooks = lastHour.filter((e) => e.kind === "webhook")

    return {
      generatedAt: at.toISOString(),
      queue: MODES.map((mode) => {
        const tickets = queue.value.filter((t) => t.modes.includes(mode))
        const oldest = Math.min(nowMs, ...tickets.map((t) => new Date(t.enqueuedAt).getTime()))
        return {
          mode,
          tickets: tickets.length,
          players: tickets.reduce((n, t) => n + t.steamIds.length, 0),
          longestWaitSec: Math.max(0, Math.floor((nowMs - oldest) / 1000)),
        }
      }),
      matches: {
        active: active.value.length,
        byStatus,
        finished24h: counts?.matchesFinished24h ?? 0,
        abandoned24h: counts?.matchesAbandoned24h ?? 0,
      },
      hosts: {
        total: hosts.value.length,
        online: hosts.value.filter((h) => h.status === "online").length,
        updating: hosts.value.filter((h) => h.updating).length,
        slotsTotal: hosts.value.reduce((n, h) => n + h.slots.total, 0),
        slotsFree: hosts.value.reduce((n, h) => n + h.slots.free, 0),
      },
      users: { total: counts?.usersTotal ?? 0, new24h: counts?.usersNew24h ?? 0 },
      moderation: {
        activeBans: counts?.activeBans ?? 0,
        openReports: counts?.openReports ?? 0,
        openFlags: counts?.openFlags ?? 0,
      },
      events: {
        errorsLastHour: lastHour.filter((e) => e.kind === "error").length,
        webhooksLastHour: webhooks.length,
        failedWebhooksLastHour: webhooks.filter((e) => e.ok === false).length,
      },
      health: {
        db,
        redis,
        queue: queue.health,
        matches: active.health,
        hosts: hosts.health,
        events: events.health,
      },
    }
  })

  app.get("/admin/queue", async (): Promise<QueueView> => {
    const tickets = await hooks.getQueueSnapshot()
    return withCards(tickets.flatMap((t) => t.steamIds), (cards) => queueView(tickets, cards, now()))
  })

  app.get<{ Querystring: { status?: string; limit?: string } }>("/admin/matches", async (req) => {
    const status = req.query.status ?? "active"
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    if (status === "active") return { status, matches: await activeMatches() }
    const statuses = status === "recent" ? RECENT_STATUSES : status.split(",")
    const bad = statuses.filter((s) => !ALL_STATUSES.includes(s))
    if (bad.length > 0) {
      throw new AdminError(400, "invalid_request", `Unknown status ${bad.join(", ")}. Use active, recent or a match status`)
    }
    return { status, matches: await store.listMatches(statuses, limit) }
  })

  app.get<{ Params: { id: string } }>("/admin/matches/:id", async (req) => {
    checkUuid(req.params.id, "Match")
    const match = await store.getMatch(req.params.id)
    if (!match) throw new AdminError(404, "not_found", "Match not found")
    return { match }
  })

  app.get("/admin/hosts", async () => ({ hosts: (await hooks.getHosts()).map(hostView) }))

  // Name search. Rate limited in lib/security.ts
  app.get("/admin/users", async (req) => {
    const { q, limit } = parse(SearchQuery, req.query)
    return { q, users: await store.searchUsers(q, limit, now()) }
  })

  app.get<{ Params: { steamId: string } }>("/admin/users/:steamId", async (req) => {
    const { steamId } = req.params
    checkSteamId(steamId)
    const [user, auditRows, tickets, match] = await Promise.all([
      store.getUser(steamId, now()),
      store.listAudit({ target: steamId, limit: 50 }),
      safe(() => hooks.getQueueSnapshot(), []),
      store.activeMatchOf(steamId, ACTIVE_STATUSES),
    ])
    if (!user) throw new AdminError(404, "not_found", "User not found")
    const ticket = tickets.value.find((t) => t.steamIds.includes(steamId))
    const state: UserStateView = {
      queue: ticket
        ? { ticketId: ticket.id, partyId: ticket.partyId, modes: ticket.modes, enqueuedAt: iso(ticket.enqueuedAt)! }
        : null,
      match,
    }
    const names = await store.userCards(auditRows.map((a) => a.adminSteamId))
    const audit = auditRows.map((a) => ({ ...a, adminName: names.get(a.adminSteamId)?.displayName ?? null }))
    return { ...user, state, audit }
  })

  app.get<{ Querystring: { limit?: string } }>("/admin/events", async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    return { events: (await hooks.recentEvents(limit)).map(eventView) }
  })

  app.post<{ Params: { ticketId: string } }>("/admin/queue/:ticketId/remove", async (req) => {
    checkUuid(req.params.ticketId, "Ticket")
    const body = parse(RemoveBody, req.body)
    const ok = await hooks.removeTicket(req.params.ticketId)
    if (!ok) throw new AdminError(404, "not_found", "Ticket not in queue")
    const entry = await audit(req, "queue.remove", req.params.ticketId, { reason: body?.reason ?? null })
    hooks.emitAdmin("queue", { action: "ticket_removed", ticketId: req.params.ticketId, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.post<{ Params: { id: string } }>("/admin/matches/:id/cancel", async (req) => {
    checkUuid(req.params.id, "Match")
    const { reason } = parse(CancelBody, req.body)
    const ok = await hooks.cancelMatch(req.params.id, reason)
    if (!ok) throw new AdminError(404, "not_found", "Match not found or already over")
    const entry = await audit(req, "match.cancel", req.params.id, { reason })
    hooks.emitAdmin("match", { action: "cancelled", matchId: req.params.id, reason, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  async function requireUser(steamId: string) {
    checkSteamId(steamId)
    if (!(await store.userExists(steamId))) throw new AdminError(404, "not_found", "User not found")
  }

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/ban", async (req) => {
    const { steamId } = req.params
    checkSteamId(steamId)
    const body = parse(BanBody, req.body)
    if (steamId === adminOf(req)) throw new AdminError(400, "invalid_request", "You cannot ban yourself")
    const until = body.until ? new Date(body.until) : null
    if (until && until.getTime() <= now().getTime()) {
      throw new AdminError(400, "invalid_request", "until must be in the future")
    }
    // A player who never signed in gets a bare row so the ban gate stops them at first login
    const createdUser = await store.ensureUser(steamId)
    await hooks.ban(steamId, body.reason, until)
    const entry = await audit(req, "user.ban", steamId, {
      reason: body.reason,
      until: until?.toISOString() ?? null,
      ...(createdUser ? { createdUser: true } : {}),
    })
    hooks.emitAdmin("user", { action: "banned", steamId, until: until?.toISOString() ?? null, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/unban", async (req) => {
    const { steamId } = req.params
    await requireUser(steamId)
    const ok = await hooks.unban(steamId)
    if (!ok) throw new AdminError(409, "not_banned", "User has no active ban")
    const entry = await audit(req, "user.unban", steamId, {})
    hooks.emitAdmin("user", { action: "unbanned", steamId, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/trust", async (req) => {
    const { steamId } = req.params
    await requireUser(steamId)
    const { level } = parse(TrustBody, req.body)
    const before = (await store.getUser(steamId, now()))?.trust?.level ?? null
    await hooks.setTrustLevel(steamId, level)
    const entry = await audit(req, "user.trust", steamId, { level, before })
    hooks.emitAdmin("user", { action: "trust_changed", steamId, level, before, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.post<{ Params: { steamId: string } }>("/admin/users/:steamId/cooldown/clear", async (req) => {
    const { steamId } = req.params
    await requireUser(steamId)
    const cleared = await store.clearCooldowns(steamId, now())
    if (cleared.length === 0) throw new AdminError(409, "no_cooldown", "User has no running cooldown")
    const entry = await audit(req, "user.cooldown_clear", steamId, { cleared })
    // The player sees the queue open again without a reload
    await hooks.notifyQueueStatus?.(steamId).catch((err) => req.log.warn({ err, steamId }, "queue status push failed"))
    hooks.emitAdmin("user", { action: "cooldown_cleared", steamId, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: Pick<AdminPluginOptions, "authenticate" | "isAdmin" | "admins">,
): Promise<string | null> {
  let steamId: string | null = null
  try {
    steamId = await opts.authenticate(req)
  } catch {
    steamId = null
  }
  if (steamId && opts.admins) await opts.admins.ensureFresh()
  if (!steamId || !opts.isAdmin(steamId)) {
    reply.callNotFound()
    return null
  }
  return steamId
}
