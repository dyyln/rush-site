import { FriendRequestBodySchema, PartyInviteBodySchema, SteamId64Schema } from "@rushsite/shared"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest, notFound } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

const IdParams = z.object({ id: z.uuid() })

function idOf(params: unknown, code: string): string {
  const r = IdParams.safeParse(params)
  if (!r.success) throw notFound(code)
  return r.data.id
}

export function registerFriendRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { friends } = ctx

  app.get("/friends", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return friends.list(steamId)
  })

  // Re-runs the Steam auto-link
  app.post("/friends/sync", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const r = await friends.syncSteam(steamId)
    return { steamListAvailable: r.available, linked: r.linked.length }
  })

  app.get("/friends/pending", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return friends.pending(steamId)
  })

  app.get("/friends/recent", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { players: await friends.recent(steamId) }
  })

  app.post("/friends/requests", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = FriendRequestBodySchema.safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.issues[0]?.message)
    const r = await friends.sendRequest(steamId, body.data.steamId)
    return reply.code(r.created ? 201 : 200).send({ request: r.request })
  })

  app.post("/friends/requests/:id/accept", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { request: await friends.accept(steamId, idOf(req.params, "request_not_found")) }
  })

  app.post("/friends/requests/:id/decline", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { request: await friends.decline(steamId, idOf(req.params, "request_not_found")) }
  })

  app.delete("/friends/requests/:id", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { request: await friends.cancel(steamId, idOf(req.params, "request_not_found")) }
  })

  app.delete("/friends/:steamId", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const other = SteamId64Schema.safeParse((req.params as { steamId?: string }).steamId)
    if (!other.success) throw badRequest("invalid_steam_id")
    await friends.unfriend(steamId, other.data)
    return reply.code(204).send()
  })

  app.post("/parties/invites", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = PartyInviteBodySchema.safeParse(req.body ?? {})
    if (!body.success) throw badRequest("invalid_body", body.error.issues[0]?.message)
    return reply.code(201).send(await friends.invite(steamId, body.data.steamId))
  })

  app.post("/parties/invites/:id/accept", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return friends.acceptInvite(steamId, idOf(req.params, "invite_not_found"))
  })

  app.post("/parties/invites/:id/decline", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return { invite: await friends.declineInvite(steamId, idOf(req.params, "invite_not_found")) }
  })
}
