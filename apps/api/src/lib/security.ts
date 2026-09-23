import { createHash } from "node:crypto"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify"
import type { Redis } from "ioredis"
import type { Env } from "../env.js"
import { sessionIdFrom } from "../modules/auth/session.js"
import { ApiError } from "./errors.js"

// Origins that may send credentialed state changes and open the socket
export function allowedOrigins(env: Pick<Env, "PUBLIC_URL" | "API_PUBLIC_URL">): Set<string> {
  return new Set([new URL(env.PUBLIC_URL).origin, new URL(env.API_PUBLIC_URL).origin])
}

// Browsers always send Origin on cross origin requests. Tools and server side calls send none
export function originAllowed(req: FastifyRequest, allowed: Set<string>): boolean {
  const origin = req.headers.origin
  if (origin !== undefined) return allowed.has(origin)
  const site = req.headers["sec-fetch-site"]
  return site !== "cross-site" && site !== "same-site"
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// CSRF guard. SameSite=Lax still lets sibling subdomains post with the cookie
export function csrfGuard(allowed: Set<string>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!UNSAFE_METHODS.has(req.method)) return
    // Webhooks are signed and come from game servers without an Origin
    if (req.url.startsWith("/webhooks/")) return
    if (originAllowed(req, allowed)) return
    return reply.code(403).send({ error: "bad_origin", message: "cross site request refused" })
  }
}

type Rule = { max: number; timeWindow: number; key?: "ip" | "match" }

const MINUTE = 60_000

// Per route limits. Anything not listed gets the global limit
export const RATE_RULES: Record<string, Rule> = {
  "GET /auth/steam": { max: 20, timeWindow: MINUTE, key: "ip" },
  "GET /auth/steam/callback": { max: 20, timeWindow: MINUTE, key: "ip" },
  "GET /ws": { max: 30, timeWindow: MINUTE },
  "POST /queue/join": { max: 30, timeWindow: MINUTE },
  "POST /queue/leave": { max: 30, timeWindow: MINUTE },
  "POST /parties/invite": { max: 20, timeWindow: MINUTE },
  "GET /parties/join/:inviteCode": { max: 30, timeWindow: MINUTE },
  "POST /parties/join/:inviteCode": { max: 30, timeWindow: MINUTE },
  "POST /parties/invites": { max: 30, timeWindow: MINUTE },
  "POST /friends/requests": { max: 20, timeWindow: MINUTE },
  "POST /friends/sync": { max: 6, timeWindow: MINUTE },
  "POST /challenges": { max: 10, timeWindow: MINUTE },
  "GET /challenges/:code": { max: 60, timeWindow: MINUTE },
  "POST /challenges/:code/accept": { max: 20, timeWindow: MINUTE },
  "POST /challenges/:code/decline": { max: 30, timeWindow: MINUTE },
  "POST /matches/:id/report": { max: 10, timeWindow: MINUTE },
  "POST /tournaments/:id/enter": { max: 20, timeWindow: MINUTE },
  "DELETE /tournaments/:id/enter": { max: 20, timeWindow: MINUTE },
  "GET /leaderboard/:mode": { max: 60, timeWindow: MINUTE },
  "GET /leaderboard/:mode/friends": { max: 60, timeWindow: MINUTE },
  "GET /leaderboard/:mode/distribution": { max: 60, timeWindow: MINUTE },
  "GET /users/:steamId/profile": { max: 60, timeWindow: MINUTE },
  "GET /users/:steamId/matches": { max: 60, timeWindow: MINUTE },
  // Signed traffic from game servers that share one IP. Limited per match instead
  "POST /webhooks/match/:matchId": { max: 1200, timeWindow: MINUTE, key: "match" },
}

export const GLOBAL_RATE = { max: 600, timeWindow: MINUTE }

const hashed = (v: string) => createHash("sha256").update(v).digest("base64url").slice(0, 22)

// Signed in callers are limited per session so players behind one NAT do not share a bucket
export function rateKey(req: FastifyRequest): string {
  const sid = sessionIdFrom(req)
  return sid ? `s:${hashed(sid)}` : `ip:${req.ip}`
}

function keyFor(kind: Rule["key"]) {
  if (kind === "ip") return (req: FastifyRequest) => `ip:${req.ip}`
  if (kind === "match") return (req: FastifyRequest) => `m:${(req.params as { matchId?: string }).matchId ?? req.ip}`
  return rateKey
}

function applyRule(route: RouteOptions): void {
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  if (route.url === "/health") {
    route.config = { ...(route.config as object), rateLimit: false } as RouteOptions["config"]
    return
  }
  for (const method of methods) {
    const rule = RATE_RULES[`${method} ${route.url}`]
    if (!rule) continue
    route.config = {
      ...(route.config as object),
      rateLimit: { max: rule.max, timeWindow: rule.timeWindow, keyGenerator: keyFor(rule.key) },
    } as RouteOptions["config"]
    return
  }
}

// Registers headers, the CSRF guard and rate limits. Call before any route is added
export async function registerSecurity(
  app: FastifyInstance,
  opts: { env: Env; redis: Redis },
): Promise<void> {
  await app.register(helmet, {
    // JSON only. Nothing here should ever render as a page or in a frame
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false,
  })
  app.addHook("onRequest", csrfGuard(allowedOrigins(opts.env)))
  if (!opts.env.RATE_LIMIT_ENABLED) return
  // Must run before the rate limit plugin reads route config
  app.addHook("onRoute", applyRule)
  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_RATE.max,
    timeWindow: GLOBAL_RATE.timeWindow,
    redis: opts.redis,
    nameSpace: "rl:",
    // Redis trouble should not take the site down
    skipOnError: true,
    keyGenerator: rateKey,
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(429, "rate_limited", `too many requests, retry in ${ctx.after}`),
  })
}

// Token bucket for inbound socket messages
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity
    this.last = now()
  }

  take(): boolean {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec)
    this.last = t
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

export const WS_MESSAGE_BURST = 30
export const WS_MESSAGES_PER_SEC = 3
// A client that keeps flooding after being told off is dropped
export const WS_MAX_STRIKES = 100
export const WS_MAX_PER_USER = 8

// Open sockets per key in this process
export class ConnectionCounter {
  private readonly open = new Map<string, number>()

  tryOpen(key: string, max: number): boolean {
    const n = this.open.get(key) ?? 0
    if (n >= max) return false
    this.open.set(key, n + 1)
    return true
  }

  close(key: string): void {
    const n = (this.open.get(key) ?? 1) - 1
    if (n <= 0) this.open.delete(key)
    else this.open.set(key, n)
  }
}
