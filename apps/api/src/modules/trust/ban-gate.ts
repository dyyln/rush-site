import { and, desc, eq, gt, isNull, or } from "drizzle-orm"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { bans } from "../../db/schema.js"

// until is an ISO time, or null for a permanent ban
export type ActiveBan = { reason: string; until: string | null }

const key = (steamId: string) => `ban:${steamId}`

// Postgres holds the bans. A Redis marker lets every request check cheaply
export class BanGate {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly now: () => number,
  ) {}

  // Reads Postgres and refreshes the marker. Used at sign in
  async lookup(steamId: string): Promise<ActiveBan | null> {
    const nowDate = new Date(this.now())
    const rows = await this.db
      .select({ reason: bans.reason, expiresAt: bans.expiresAt })
      .from(bans)
      .where(and(eq(bans.steamId, steamId), isNull(bans.revokedAt), or(isNull(bans.expiresAt), gt(bans.expiresAt, nowDate))))
      .orderBy(desc(bans.createdAt))
    if (rows.length === 0) {
      await this.clear(steamId)
      return null
    }
    // A permanent ban wins over any timed one, otherwise the one that ends last
    const permanent = rows.find((r) => !r.expiresAt)
    const pick = permanent ?? rows.reduce((a, b) => (b.expiresAt!.getTime() > a.expiresAt!.getTime() ? b : a))
    const ban = { reason: pick.reason, until: pick.expiresAt ? pick.expiresAt.toISOString() : null }
    await this.mark(steamId, ban)
    return ban
  }

  // Marker only. Used on every authenticated request
  async cached(steamId: string): Promise<ActiveBan | null> {
    const raw = await this.redis.get(key(steamId))
    if (!raw) return null
    try {
      const ban = JSON.parse(raw) as ActiveBan
      if (ban.until && Date.parse(ban.until) <= this.now()) return null
      return ban
    } catch {
      return null
    }
  }

  async mark(steamId: string, ban: ActiveBan): Promise<void> {
    const value = JSON.stringify(ban)
    if (!ban.until) {
      await this.redis.set(key(steamId), value)
      return
    }
    const ttl = Date.parse(ban.until) - this.now()
    if (ttl > 0) await this.redis.set(key(steamId), value, "PX", ttl)
  }

  async clear(steamId: string): Promise<void> {
    await this.redis.del(key(steamId))
  }
}
