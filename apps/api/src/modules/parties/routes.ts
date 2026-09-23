import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { AppContext } from "../../context.js"
import { badRequest } from "../../lib/errors.js"
import { requireUser } from "../auth/session.js"

const TargetBody = z.object({ steamId: z.string().regex(/^\d{17}$/) })

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

  // Steam friends passthrough. Registered friends can be invited directly
  app.get("/friends", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    if (!ctx.steam.enabled) return { available: false, reason: "steam_api_disabled", friends: [] }
    const list = await ctx.steam.friendList(steamId)
    if (list === null) return { available: false, reason: "friends_private", friends: [] }
    const ids = list.map((f) => f.steamid)
    const summaries = await ctx.steam.playerSummaries(ids)
    const registered = await ctx.users.cards(ids)
    const byId = new Map(summaries.map((s) => [s.steamid, s]))
    const friends = list.map((f) => {
      const s = byId.get(f.steamid) as (typeof summaries)[number] & { personastate?: number; gameid?: string }
      return {
        steamId: f.steamid,
        displayName: s?.personaname ?? registered.get(f.steamid)?.displayName ?? f.steamid,
        avatarUrl: s?.avatarmedium ?? s?.avatar ?? null,
        // Steam persona state. 0 offline, 1 online, 2 busy, 3 away
        personaState: s?.personastate ?? 0,
        inGame: s?.gameid ?? null,
        registered: registered.has(f.steamid),
        friendSince: f.friend_since,
      }
    })
    friends.sort((a, b) => Number(b.registered) - Number(a.registered) || b.personaState - a.personaState)
    return { available: true, friends }
  })
}
