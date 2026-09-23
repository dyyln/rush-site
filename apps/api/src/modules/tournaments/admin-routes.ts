// Admin cup tools. Registered inside the tournaments plugin so they share its service.
import {
  CancelCupSchema,
  CreateCupSchema,
  CupSchedulePatchSchema,
  CupScheduleCreateSchema,
  DisqualifyEntrySchema,
  ForceResultSchema,
  RescheduleCupSchema,
} from "@rushsite/shared"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { TournamentError, type TournamentService } from "./service.js"
import { isUuid, type TournamentStore } from "./store.js"

export interface AdminGate {
  authenticate(request: FastifyRequest): Promise<string | null>
  isAdmin(steamId: string): boolean
}

type Id = { Params: { id: string } }

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {})
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
    throw new TournamentError(400, "invalid_request", msg)
  }
  return r.data
}

function checkId(id: string, what: string) {
  if (!isUuid(id)) throw new TournamentError(404, "not_found", `${what} not found`)
}

export function registerAdminRoutes(
  app: FastifyInstance,
  service: TournamentService,
  store: TournamentStore,
  gate: AdminGate,
) {
  const admins = new WeakMap<FastifyRequest, string>()

  // Same rule as the admin module. Anyone who is not an admin gets the stock 404.
  async function guard(req: FastifyRequest, reply: FastifyReply) {
    let steamId: string | null = null
    try {
      steamId = await gate.authenticate(req)
    } catch {
      steamId = null
    }
    if (!steamId || !gate.isAdmin(steamId)) return reply.callNotFound()
    admins.set(req, steamId)
  }

  async function audit(req: FastifyRequest, action: string, target: string, payload: unknown) {
    const adminSteamId = admins.get(req)
    if (!adminSteamId) throw new Error("admin identity missing")
    try {
      await store.writeAudit({ adminSteamId, action, target, payload })
    } catch (err) {
      req.log.error({ err, action, target }, "admin audit write failed")
    }
  }

  const opts = { onRequest: guard }

  app.get("/admin/tournaments/schedules", opts, async () => ({ schedules: await service.listSchedules() }))

  app.post("/admin/tournaments/schedules", opts, async (req, reply) => {
    const body = parse(CupScheduleCreateSchema, req.body)
    const schedule = await service.createSchedule({ ...body, weekday: body.weekday ?? null })
    await audit(req, "tournament.schedule_create", schedule.id, body)
    return reply.code(201).send({ schedule })
  })

  app.patch<Id>("/admin/tournaments/schedules/:id", opts, async (req) => {
    checkId(req.params.id, "Schedule")
    const body = parse(CupSchedulePatchSchema, req.body)
    const schedule = await service.updateSchedule(req.params.id, body)
    await audit(req, "tournament.schedule_update", schedule.id, body)
    return { schedule }
  })

  app.delete<Id>("/admin/tournaments/schedules/:id", opts, async (req) => {
    checkId(req.params.id, "Schedule")
    const removed = await service.deleteSchedule(req.params.id)
    await audit(req, "tournament.schedule_delete", removed.id, { cupKey: removed.cupKey, name: removed.name })
    return { ok: true }
  })

  app.post("/admin/tournaments", opts, async (req, reply) => {
    const body = parse(CreateCupSchema, req.body)
    const tournament = await service.createCup({ ...body, startsAt: new Date(body.startsAt) })
    await audit(req, "tournament.create", tournament.id, body)
    return reply.code(201).send({ tournament })
  })

  app.post<Id>("/admin/tournaments/:id/cancel", opts, async (req) => {
    checkId(req.params.id, "Tournament")
    const { reason } = parse(CancelCupSchema, req.body)
    const tournament = await service.cancel(req.params.id)
    await audit(req, "tournament.cancel", req.params.id, { reason })
    return { ok: true, tournament }
  })

  app.post<Id>("/admin/tournaments/:id/reschedule", opts, async (req) => {
    checkId(req.params.id, "Tournament")
    const body = parse(RescheduleCupSchema, req.body)
    const { before, tournament } = await service.reschedule(req.params.id, new Date(body.startsAt))
    await audit(req, "tournament.reschedule", req.params.id, { from: before, to: tournament.startsAt })
    return { ok: true, tournament }
  })

  app.post<{ Params: { id: string; entryId: string } }>(
    "/admin/tournaments/:id/entries/:entryId/disqualify",
    opts,
    async (req) => {
      checkId(req.params.id, "Tournament")
      checkId(req.params.entryId, "Entry")
      const { reason } = parse(DisqualifyEntrySchema, req.body)
      const entry = await service.disqualify(req.params.id, req.params.entryId, reason)
      await audit(req, "tournament.disqualify", req.params.id, {
        entryId: entry.id,
        steamIds: entry.steamIds,
        teamName: entry.teamName,
        reason,
      })
      return { ok: true, tournament: await service.summaryOf(req.params.id) }
    },
  )

  app.post<{ Params: { id: string; bracketMatchId: string } }>(
    "/admin/tournaments/:id/matches/:bracketMatchId/force-result",
    opts,
    async (req) => {
      checkId(req.params.id, "Tournament")
      const { winnerEntryId, reason } = parse(ForceResultSchema, req.body)
      const { loserEntryId } = await service.forceResult(req.params.id, req.params.bracketMatchId, winnerEntryId)
      await audit(req, "tournament.force_result", req.params.id, {
        bracketMatchId: req.params.bracketMatchId,
        winnerEntryId,
        loserEntryId,
        reason,
      })
      return { ok: true, tournament: await service.summaryOf(req.params.id) }
    },
  )
}
