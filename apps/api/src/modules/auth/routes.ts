import { eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { users } from "../../db/schema.js"
import { ApiError, unauthorized } from "../../lib/errors.js"
import { randomToken } from "../../lib/hmac.js"
import type { AppContext } from "../../context.js"
import { SESSION_COOKIE, requireUser, sessionIdFrom, setSessionCookie } from "./session.js"
import { buildLoginUrl, checkAssertion, verifyWithSteam } from "./steam.js"

const LOGIN_COOKIE = "rs_login"

// Only same site relative paths are allowed as post login targets
export function safeRedirectPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return "/"
  // Browsers drop tabs and newlines, which would turn /\t/evil into //evil
  if (/[\u0000-\u001f\u007f]/.test(p) || p.length > 512) return "/"
  return p
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { env } = ctx
  const secure = env.NODE_ENV === "production"
  const callbackUrl = `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/auth/steam/callback`
  const realm = new URL(env.API_PUBLIC_URL).origin
  const web = env.PUBLIC_URL.replace(/\/+$/, "")

  app.get("/auth/steam", async (req, reply) => {
    const state = randomToken(16)
    const q = req.query as Record<string, unknown>
    const redirect = safeRedirectPath(q.returnTo ?? q.redirect)
    reply.setCookie(LOGIN_COOKIE, JSON.stringify({ state, redirect }), {
      path: "/auth/steam",
      httpOnly: true,
      sameSite: "lax",
      secure,
      signed: true,
      maxAge: 600,
    })
    return reply.redirect(buildLoginUrl(realm, `${callbackUrl}?state=${state}`), 302)
  })

  app.get("/auth/steam/callback", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const fail = (reason: string) => {
      req.log.warn({ reason }, "steam login rejected")
      return reply.redirect(`${web}/login?error=${encodeURIComponent(reason)}`, 302)
    }
    const raw = req.cookies[LOGIN_COOKIE]
    const unsigned = raw ? req.unsignCookie(raw) : null
    reply.clearCookie(LOGIN_COOKIE, { path: "/auth/steam" })
    if (!unsigned?.valid || !unsigned.value) return fail("state_missing")
    let login: { state: string; redirect: string }
    try {
      login = JSON.parse(unsigned.value) as { state: string; redirect: string }
    } catch {
      return fail("state_invalid")
    }
    if (!query.state || query.state !== login.state) return fail("state_mismatch")

    const check = checkAssertion(query, `${callbackUrl}?state=${login.state}`, ctx.now())
    if (!check.ok) return fail(check.reason)
    const fresh = await ctx.redis.set(`openid:nonce:${check.nonce}`, "1", "EX", 3600, "NX")
    if (fresh !== "OK") return fail("nonce_replayed")
    let valid = false
    try {
      valid = await verifyWithSteam(query, ctx.fetch)
    } catch (err) {
      req.log.error({ err }, "steam openid verification failed")
      return fail("steam_unreachable")
    }
    if (!valid) return fail("signature")

    const steamId = check.steamId
    // A banned player gets no session, only the page that says why and until when
    const ban = await ctx.banGate.lookup(steamId)
    if (ban) {
      req.log.info({ steamId }, "banned player sign in refused")
      const q = new URLSearchParams({ until: ban.until ?? "", reason: ban.reason })
      if (!ban.until) q.set("permanent", "1")
      return reply.redirect(`${web}/banned?${q.toString()}`, 302)
    }
    let summary = null
    let playtime: number | null = null
    try {
      summary = (await ctx.steam.playerSummaries([steamId]))[0] ?? null
      playtime = await ctx.steam.cs2Playtime(steamId)
    } catch (err) {
      req.log.warn({ err, steamId }, "steam profile fetch failed")
    }
    await ctx.users.upsertFromSteam(steamId, summary, playtime)
    const sid = await ctx.sessions.create(steamId)
    setSessionCookie(reply, sid, { secure, domain: env.COOKIE_DOMAIN, maxAgeSec: env.SESSION_TTL_DAYS * 86400 })
    void ctx.trust.onLogin(steamId).catch((err) => req.log.error({ err, steamId }, "trust refresh failed"))
    // Puts the role back after a timed ban ran out
    ctx.discord.syncQuietly(steamId)
    void ctx.friends.syncSteam(steamId).catch((err) => req.log.warn({ err, steamId }, "steam friends auto-link failed"))
    return reply.redirect(`${web}${login.redirect}`, 302)
  })

  app.post("/auth/logout", async (req, reply) => {
    const sid = sessionIdFrom(req)
    const steamId = sid ? await ctx.sessions.get(sid) : null
    if (sid) await ctx.sessions.destroy(sid)
    if (steamId) ctx.disconnectUser(steamId, "logged_out")
    reply.clearCookie(SESSION_COOKIE, { path: "/", ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) })
    return reply.code(204).send()
  })

  app.get("/trust/levels", async () => ctx.trust.levelDefinitions())

  app.get("/me", async (req) => {
    // 403 with the ban so the web can show the banned page
    const sid = sessionIdFrom(req)
    const sessionUser = sid ? await ctx.sessions.get(sid) : null
    const ban = sessionUser ? await ctx.banGate.cached(sessionUser) : null
    if (ban) throw new ApiError(403, "banned", "this account is banned", ban)
    const steamId = await requireUser(ctx.auth, req)
    const [user] = await ctx.db.select().from(users).where(eq(users.steamId, steamId))
    if (!user) throw unauthorized()
    const trust = (await ctx.trust.levels([steamId]))[steamId]!
    return {
      user: {
        steamId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        trustLevel: trust,
        region: user.region,
        isAdmin: ctx.isAdmin(steamId),
      },
      trust: await ctx.trust.progress(steamId),
      settings: await ctx.queue.getSettings(steamId),
    }
  })
}
