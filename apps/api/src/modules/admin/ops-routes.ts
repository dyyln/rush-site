import {
  AnnouncementCreateSchema,
  AnnouncementPatchSchema,
  FlagKeySchema,
  FlagWriteSchema,
  MODES,
  MetricsRangeSchema,
  UuidSchema,
  queueOpenFlag,
  type Mode,
} from "@rushsite/shared"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { z } from "zod"
import { eq } from "drizzle-orm"
import { hosts } from "../../db/schema.js"
import { hostMetricsView } from "./host-metrics.js"
import { metricsView } from "./metrics.js"
import { AdminError } from "./routes.js"
import type { AdminStore } from "./store.js"
import type { AdminPluginOptions, AnnouncementWrite, AnnouncementsLike, AuditAction, FlagsLike } from "./types.js"

export interface OpsDeps {
  store: AdminStore
  opts: Pick<
    AdminPluginOptions,
    "db" | "flags" | "announcements" | "metrics" | "onModeClosed" | "onQueueFlagChanged" | "resolveVanity" | "emitAdmin"
  >
  now(): Date
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new AdminError(400, "invalid_request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "))
  }
  return r.data
}

// The mode a queue open flag controls, or null for any other key
export function modeOfQueueFlag(key: string): Mode | null {
  return MODES.find((m) => queueOpenFlag(m) === key) ?? null
}

// Pulls a SteamID64 or a vanity name out of an id or a steamcommunity.com profile URL
export function parseProfileInput(input: string): { steamId: string } | { vanity: string } | null {
  const s = input.trim()
  if (/^\d{17}$/.test(s)) return { steamId: s }
  const profiles = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i)
  if (profiles) return { steamId: profiles[1]! }
  const vanity = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,64})/i)
  if (vanity) return { vanity: vanity[1]! }
  return null
}

export function registerOpsRoutes(app: FastifyInstance, deps: OpsDeps, adminOf: (req: FastifyRequest) => string) {
  const { store, opts, now } = deps

  const audit = (req: FastifyRequest, action: AuditAction, target: string, payload: unknown) =>
    store.writeAudit({ adminSteamId: adminOf(req), action, target, payload })

  const flags = (): FlagsLike => {
    if (!opts.flags) throw new AdminError(404, "not_found", "Flags are not available")
    return opts.flags
  }
  const notices = (): AnnouncementsLike => {
    if (!opts.announcements) throw new AdminError(404, "not_found", "Announcements are not available")
    return opts.announcements
  }

  // A failed push must not fail the write. The status loop catches up
  const queueFlagChanged = async () => {
    try {
      await opts.onQueueFlagChanged?.()
    } catch {
      // Ignored
    }
  }

  app.get("/admin/flags", async () => ({ flags: await flags().list() }))

  app.put<{ Params: { key: string } }>("/admin/flags/:key", async (req) => {
    const key = parse(FlagKeySchema, req.params.key)
    const body = parse(FlagWriteSchema, req.body)
    const { flag, before } = await flags().set(key, body.enabled, body.value, adminOf(req))
    const entry = await audit(req, "flag.set", key, {
      enabled: flag.enabled,
      value: flag.value,
      before: before ? { enabled: before.enabled, value: before.value } : null,
    })
    const mode = modeOfQueueFlag(key)
    let drained = 0
    if (mode) {
      const wasOpen = before?.enabled ?? true
      // Cards change before the drained tickets hear why they left
      if (wasOpen !== flag.enabled) await queueFlagChanged()
      if (wasOpen && !flag.enabled && opts.onModeClosed) drained = await opts.onModeClosed(mode)
      if (wasOpen !== flag.enabled) {
        opts.emitAdmin("queue", { action: flag.enabled ? "mode_opened" : "mode_closed", mode, drained, by: entry.adminSteamId })
      }
    }
    return { flag, audit: entry, ...(mode ? { drained } : {}) }
  })

  app.delete<{ Params: { key: string } }>("/admin/flags/:key", async (req) => {
    const key = parse(FlagKeySchema, req.params.key)
    const removed = await flags().remove(key)
    if (!removed) throw new AdminError(404, "not_found", "Flag not found")
    const entry = await audit(req, "flag.delete", key, { enabled: removed.enabled, value: removed.value })
    const mode = modeOfQueueFlag(key)
    // A missing queue flag means open
    if (mode && !removed.enabled) await queueFlagChanged()
    if (mode && !removed.enabled) opts.emitAdmin("queue", { action: "mode_opened", mode, by: entry.adminSteamId })
    return { ok: true, audit: entry }
  })

  app.get("/admin/announcements", async () => ({ announcements: await notices().list(200) }))

  function checkWindow(startsAt: Date, endsAt: Date | null) {
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new AdminError(400, "invalid_request", "endsAt must be after startsAt")
    }
  }

  app.post("/admin/announcements", async (req, reply) => {
    const body = parse(AnnouncementCreateSchema, req.body)
    const input: AnnouncementWrite = {
      text: body.text,
      level: body.level,
      startsAt: body.startsAt ? new Date(body.startsAt) : now(),
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      dismissible: body.dismissible,
    }
    checkWindow(input.startsAt, input.endsAt)
    const announcement = await notices().create(input, adminOf(req))
    const entry = await audit(req, "announcement.create", announcement.id, announcement)
    return reply.code(201).send({ announcement, audit: entry })
  })

  app.patch<{ Params: { id: string } }>("/admin/announcements/:id", async (req) => {
    if (!UuidSchema.safeParse(req.params.id).success) throw new AdminError(404, "not_found", "Announcement not found")
    const body = parse(AnnouncementPatchSchema, req.body ?? {})
    const before = await notices().get(req.params.id)
    if (!before) throw new AdminError(404, "not_found", "Announcement not found")
    const patch: Partial<AnnouncementWrite> = {}
    if (body.text !== undefined) patch.text = body.text
    if (body.level !== undefined) patch.level = body.level
    if (body.dismissible !== undefined) patch.dismissible = body.dismissible
    if (body.startsAt !== undefined) patch.startsAt = new Date(body.startsAt)
    if (body.endsAt !== undefined) patch.endsAt = body.endsAt ? new Date(body.endsAt) : null
    checkWindow(
      patch.startsAt ?? new Date(before.startsAt),
      patch.endsAt !== undefined ? patch.endsAt : before.endsAt ? new Date(before.endsAt) : null,
    )
    const announcement = await notices().update(req.params.id, patch)
    if (!announcement) throw new AdminError(404, "not_found", "Announcement not found")
    const entry = await audit(req, "announcement.update", announcement.id, { patch: body, before })
    return { announcement, audit: entry }
  })

  app.delete<{ Params: { id: string } }>("/admin/announcements/:id", async (req) => {
    if (!UuidSchema.safeParse(req.params.id).success) throw new AdminError(404, "not_found", "Announcement not found")
    const removed = await notices().remove(req.params.id)
    if (!removed) throw new AdminError(404, "not_found", "Announcement not found")
    const entry = await audit(req, "announcement.delete", removed.id, removed)
    return { ok: true, audit: entry }
  })

  app.get<{ Querystring: { range?: string } }>("/admin/metrics", async (req) => {
    const range = parse(MetricsRangeSchema, req.query.range ?? "1h")
    return opts.metrics ? opts.metrics(range, now()) : metricsView(opts.db, range, now())
  })

  // History for one host's charts. Long ranges come back as bucket means
  app.get<{ Params: { id: string }; Querystring: { range?: string } }>("/admin/hosts/:id/metrics", async (req) => {
    if (!UuidSchema.safeParse(req.params.id).success) throw new AdminError(404, "not_found", "Host not found")
    const range = parse(MetricsRangeSchema, req.query.range ?? "1h")
    const [host] = await opts.db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, req.params.id))
    if (!host) throw new AdminError(404, "not_found", "Host not found")
    return hostMetricsView(opts.db, host.id, range, now())
  })

  // Resolves a SteamID64 or profile URL for the manual ban form
  app.get<{ Querystring: { q?: string } }>("/admin/users/resolve", async (req) => {
    const parsed = parseProfileInput(req.query.q ?? "")
    if (!parsed) throw new AdminError(400, "invalid_request", "Enter a SteamID64 or a steamcommunity.com profile URL")
    let steamId: string | null = "steamId" in parsed ? parsed.steamId : null
    if (!steamId && "vanity" in parsed) {
      steamId = opts.resolveVanity ? await opts.resolveVanity(parsed.vanity) : null
      if (!steamId) throw new AdminError(404, "not_found", `Could not resolve the custom URL ${parsed.vanity}`)
    }
    const exists = await store.userExists(steamId!)
    const cards = exists ? await store.userCards([steamId!]) : new Map()
    return { steamId, registered: exists, user: cards.get(steamId!) ?? null }
  })
}
