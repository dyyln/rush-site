import type { FastifyInstance } from "fastify"
import type { AppContext } from "../../context.js"
import { ApiError } from "../../lib/errors.js"
import { randomToken } from "../../lib/hmac.js"
import { requireUser } from "../auth/session.js"
import { DISCORD_AUTHORIZE_URL, DISCORD_SCOPES } from "./client.js"

const STATE_TTL_SEC = 600
const stateKey = (state: string) => `discord:state:${state}`

export function discordRedirectUri(apiPublicUrl: string): string {
  return `${apiPublicUrl.replace(/\/+$/, "")}/auth/discord/callback`
}

export function registerDiscordRoutes(app: FastifyInstance, ctx: AppContext): void {
  const web = ctx.env.PUBLIC_URL.replace(/\/+$/, "")
  // The settings page reads the outcome from the query
  const back = (outcome: string) => `${web}/settings?discord=${encodeURIComponent(outcome)}#discord`

  app.get("/discord/me", async (req) => ctx.discord.status(await requireUser(ctx.auth, req)))

  app.post("/discord/unlink", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    await ctx.discord.unlink(steamId)
    return ctx.discord.status(steamId)
  })

  // Gives the role again, for example after joining with the invite link
  app.post("/discord/sync", async (req) => {
    const steamId = await requireUser(ctx.auth, req)
    if (!ctx.discord.enabled) throw new ApiError(404, "discord_disabled", "Discord linking is not set up")
    await ctx.discord.sync(steamId)
    return ctx.discord.status(steamId)
  })

  app.get("/auth/discord", async (req, reply) => {
    const steamId = await ctx.auth(req)
    if (!steamId) return reply.redirect(back("signed_out"), 302)
    if (!ctx.discord.enabled || !ctx.env.DISCORD_CLIENT_ID) return reply.redirect(back("disabled"), 302)
    const state = randomToken(16)
    await ctx.redis.set(stateKey(state), steamId, "EX", STATE_TTL_SEC)
    const q = new URLSearchParams({
      client_id: ctx.env.DISCORD_CLIENT_ID,
      response_type: "code",
      redirect_uri: discordRedirectUri(ctx.env.API_PUBLIC_URL),
      scope: DISCORD_SCOPES.join(" "),
      state,
    })
    return reply.redirect(`${DISCORD_AUTHORIZE_URL}?${q.toString()}`, 302)
  })

  app.get("/auth/discord/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const state = q.state ?? ""
    const owner = state ? await ctx.redis.get(stateKey(state)) : null
    if (owner) await ctx.redis.del(stateKey(state))
    if (q.error) return reply.redirect(back(q.error === "access_denied" ? "cancelled" : "failed"), 302)
    if (!owner || !q.code) return reply.redirect(back("expired"), 302)
    // The browser that finishes must be the one that started
    const steamId = await ctx.auth(req)
    if (steamId !== owner) return reply.redirect(back("expired"), 302)
    try {
      const { joined } = await ctx.discord.link(steamId, q.code)
      return reply.redirect(back(joined ? "joined" : "linked"), 302)
    } catch (err) {
      if (err instanceof ApiError && err.code === "discord_taken") return reply.redirect(back("taken"), 302)
      req.log.warn({ err, steamId }, "discord link failed")
      return reply.redirect(back("failed"), 302)
    }
  })
}
