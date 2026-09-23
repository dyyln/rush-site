import { MatchWebhookBodySchema, WEBHOOK_SIGNATURE_HEADER, type VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { matchPlayers, matches, vetoes } from "../../db/schema.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { verifySignature } from "../../lib/hmac.js"
import { requireUser } from "../auth/session.js"

const AcceptBody = z.object({ accept: z.boolean() })
const VetoBody = z.object({ mapId: z.string().min(1) })
const Uuid = z.uuid()

export async function matchView(ctx: AppContext, matchId: string, viewer: string | null) {
  const [m] = await ctx.db.select().from(matches).where(eq(matches.id, matchId))
  if (!m) return null
  const players = await ctx.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
  const cards = await ctx.users.cards(players.map((p) => p.steamId))
  const [veto] = await ctx.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
  const participant = !!viewer && players.some((p) => p.steamId === viewer)
  const showConnect = participant && (m.status === "ready" || m.status === "live" || m.status === "starting")
  return {
    id: m.id,
    mode: m.mode,
    status: m.status,
    source: m.source,
    region: m.region,
    maps: m.maps ?? [],
    mapId: m.mapId,
    winnerTeam: m.winnerTeam,
    score: m.score ?? {},
    acceptDeadline: m.acceptDeadline?.getTime() ?? null,
    createdAt: m.createdAt.toISOString(),
    endedAt: m.endedAt?.toISOString() ?? null,
    teams: m.teams.map((t, idx) => ({
      name: t.name,
      players: players
        .filter((p) => p.team === idx)
        .map((p) => ({
          steamId: p.steamId,
          displayName: cards.get(p.steamId)?.displayName ?? p.steamId,
          avatarUrl: cards.get(p.steamId)?.avatarUrl ?? null,
          accepted: p.accepted,
          connected: p.connected,
          abandoned: p.abandoned,
          kills: p.kills,
          deaths: p.deaths,
          headshots: p.headshots,
          damage: p.damage,
        })),
    })),
    veto: veto ? { state: veto.state as VetoState, stepDeadline: veto.stepDeadline?.getTime() ?? null } : null,
    connect: showConnect ? m.connect : null,
  }
}

async function rawJsonParser(req: FastifyRequest, body: Buffer): Promise<unknown> {
  ;(req as FastifyRequest & { rawBody?: Buffer }).rawBody = body
  if (body.length === 0) return {}
  return JSON.parse(body.toString("utf8"))
}

export function registerMatchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/matches/current", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const m = await ctx.flow.activeMatchFor(steamId)
    return { match: m ? await matchView(ctx, m.id, steamId) : null }
  })

  app.get("/matches/:id", async (req) => {
    const { id } = req.params as { id: string }
    if (!Uuid.safeParse(id).success) throw notFound("match_not_found")
    const viewer = await ctx.auth(req)
    const view = await matchView(ctx, id, viewer)
    if (!view) throw notFound("match_not_found")
    return view
  })

  app.post("/matches/:id/accept", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const { id } = req.params as { id: string }
    const body = AcceptBody.safeParse(req.body)
    if (!body.success) throw badRequest("invalid_body")
    await ctx.flow.respond(steamId, id, body.data.accept)
    return reply.code(204).send()
  })

  app.post("/matches/:id/veto", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const { id } = req.params as { id: string }
    const body = VetoBody.safeParse(req.body)
    if (!body.success) throw badRequest("invalid_body")
    await ctx.flow.vote(steamId, id, body.data.mapId)
    return reply.code(204).send()
  })

  // Plugin and agent webhooks. The HMAC covers the exact raw body so JSON is parsed by hand here
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (req, body, done) => {
      rawJsonParser(req, body as Buffer).then(
        (v) => done(null, v),
        () => done(badRequest("invalid_json"), undefined),
      )
    })
    scope.post("/webhooks/match/:matchId", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
      const { matchId } = req.params as { matchId: string }
      if (!Uuid.safeParse(matchId).success) throw notFound("match_not_found")
      const [m] = await ctx.db
        .select({ secret: matches.webhookSecret })
        .from(matches)
        .where(eq(matches.id, matchId))
      if (!m) throw notFound("match_not_found")
      const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0)
      const header = req.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()]
      if (!verifySignature(raw, m.secret, Array.isArray(header) ? header[0] : header)) {
        ctx.events.record({ kind: "webhook", type: "bad_signature", message: "signature rejected", matchId, ok: false })
        return reply.code(401).send({ error: "bad_signature" })
      }
      const parsed = MatchWebhookBodySchema.safeParse(req.body)
      if (!parsed.success) {
        ctx.events.record({ kind: "webhook", type: "invalid_event", message: "body failed validation", matchId, ok: false, detail: parsed.error.issues.slice(0, 5) })
        throw badRequest("invalid_event", parsed.error.message)
      }
      // Events for a match that is already over are acknowledged and ignored
      await ctx.flow.handleEvent(matchId, parsed.data.event)
      return reply.code(200).send({ ok: true })
    })
  })
}
