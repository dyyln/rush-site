import type { FastifyInstance } from "fastify"
import { SteamId64Schema } from "@rushsite/shared"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

const TargetBody = z.object({ steamId: SteamId64Schema })

export function registerPartyRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Every party route answers with the same PartyUpdatePayload the socket sends
  const withLink = (info: Awaited<ReturnType<typeof ctx.parties.partyOf>>) => ctx.parties.payload(info)

  app.get("/parties/me", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return withLink(await ctx.parties.partyOf(steamId))
  })

  app.post("/parties", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return withLink(await ctx.parties.create(steamId))
  })

  // Issues a fresh invite code. Old links stop working
  app.post("/parties/invite", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    return withLink(await ctx.parties.rotateInvite(steamId))
  })

  // Signed out visitors may look at an invite before signing in
  app.get("/parties/join/:inviteCode", async (req) => {
    const { inviteCode: code } = req.params as { inviteCode: string }
    return ctx.parties.preview(code, await ctx.auth(req))
  })

  app.post("/parties/join/:inviteCode", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const { inviteCode: code } = req.params as { inviteCode: string }
    return withLink(await ctx.parties.join(steamId, code))
  })

  app.post("/parties/leave", async (req, reply) => {
    const steamId = await requireUser(ctx.auth, req)
    await ctx.parties.leave(steamId)
    return reply.code(204).send()
  })

  app.post("/parties/leader", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const body = TargetBody.safeParse(req.body)
    if (!body.success) throw badRequest("invalid_body")
    return withLink(await ctx.parties.setLeader(steamId, body.data.steamId))
  })

  app.delete("/parties/members/:steamId", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    const target = TargetBody.safeParse(req.params)
    if (!target.success) throw badRequest("invalid_steam_id")
    return withLink(await ctx.parties.kick(steamId, target.data.steamId))
  })
}
