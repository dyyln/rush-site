import type { FastifyReply, FastifyRequest } from "fastify"
import type { Redis } from "ioredis"
import { randomToken } from "../../lib/hmac.js"
import { ApiError, unauthorized } from "../../lib/errors.js"

export const SESSION_COOKIE = "rs_sid"

// Server side sessions in Redis. The cookie only holds a signed random id
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec: number,
  ) {}

  async create(steamId: string): Promise<string> {
    const id = randomToken(32)
    await this.redis.multi().set(`sess:${id}`, steamId, "EX", this.ttlSec).sadd(`sess:u:${steamId}`, id).exec()
    return id
  }

  async get(id: string): Promise<string | null> {
    return this.redis.get(`sess:${id}`)
  }

  async destroy(id: string): Promise<void> {
    const steamId = await this.redis.get(`sess:${id}`)
    const tx = this.redis.multi().del(`sess:${id}`)
    if (steamId) tx.srem(`sess:u:${steamId}`, id)
    await tx.exec()
  }

  async destroyAll(steamId: string): Promise<void> {
    const ids = await this.redis.smembers(`sess:u:${steamId}`)
    const tx = this.redis.multi().del(`sess:u:${steamId}`)
    for (const id of ids) tx.del(`sess:${id}`)
    await tx.exec()
  }
}

export function sessionIdFrom(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE]
  if (!raw) return null
  const r = request.unsignCookie(raw)
  return r.valid && r.value ? r.value : null
}

export type Authenticator = (request: FastifyRequest) => Promise<string | null>

export const banned = () => new ApiError(401, "banned")

// A banned player's session is refused on every request
export function makeAuthenticator(sessions: SessionStore, isBanned: (steamId: string) => Promise<unknown>): Authenticator {
  return async (request) => {
    const id = sessionIdFrom(request)
    const steamId = id ? await sessions.get(id) : null
    if (steamId && (await isBanned(steamId))) throw banned()
    return steamId
  }
}

export async function requireUser(auth: Authenticator, request: FastifyRequest): Promise<string> {
  const steamId = await auth(request)
  if (!steamId) throw unauthorized()
  return steamId
}

export type CookieOpts = { secure: boolean; domain: string | undefined; maxAgeSec: number }

export function setSessionCookie(reply: FastifyReply, id: string, o: CookieOpts): void {
  reply.setCookie(SESSION_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: o.secure,
    signed: true,
    maxAge: o.maxAgeSec,
    ...(o.domain ? { domain: o.domain } : {}),
  })
}
