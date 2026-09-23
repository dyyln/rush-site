import { MatchReportBodySchema } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { matchPlayers, matches, reports } from "../../db/schema.js"
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

const Uuid = z.uuid()

// Reports only make sense once the players were on the server
const REPORTABLE = new Set(["live", "finished", "abandoned"])

export function registerMatchExtrasRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/matches/:id/report", async (req, reply) => {
    const reporter = await requireUser(ctx.auth, req)
    const { id } = req.params as { id: string }
    if (!Uuid.safeParse(id).success) throw notFound("match_not_found")
    const body = MatchReportBodySchema.safeParse(req.body)
    if (!body.success) throw badRequest("invalid_body", body.error.message)
    const { steamId: target, reason, note } = body.data

    const [m] = await ctx.db.select({ status: matches.status, startedAt: matches.startedAt }).from(matches).where(eq(matches.id, id))
    if (!m) throw notFound("match_not_found")
    if (!REPORTABLE.has(m.status) && !m.startedAt) throw conflict("match_not_started")
    if (target === reporter) throw badRequest("cannot_report_self")

    const players = await ctx.db.select({ steamId: matchPlayers.steamId }).from(matchPlayers).where(eq(matchPlayers.matchId, id))
    const ids = new Set(players.map((p) => p.steamId))
    if (!ids.has(reporter)) throw forbidden("not_a_participant")
    if (!ids.has(target)) throw badRequest("player_not_in_match")

    const [row] = await ctx.db
      .insert(reports)
      .values({ reporterSteamId: reporter, reportedSteamId: target, matchId: id, reason, detail: note || null })
      .onConflictDoNothing()
      .returning({ id: reports.id, createdAt: reports.createdAt })
    if (!row) throw conflict("already_reported")
    return reply.code(201).send({ report: { id: row.id, matchId: id, steamId: target, reason, createdAt: row.createdAt.toISOString() } })
  })
}

