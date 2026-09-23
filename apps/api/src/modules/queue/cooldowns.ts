import { COOLDOWN_LADDERS, cooldownSeconds, type CooldownReason } from "@rushsite/shared"
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { cooldowns } from "../../db/schema.js"

export type ActiveCooldown = { steamId: string; reason: CooldownReason; endsAt: number }

// Short cooldowns for declines, escalating ones for abandons
export class CooldownService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async issue(steamId: string, reason: CooldownReason, matchId: string | null): Promise<ActiveCooldown> {
    const ladder = COOLDOWN_LADDERS[reason]
    const sameLadder = (Object.keys(COOLDOWN_LADDERS) as CooldownReason[]).filter((r) => COOLDOWN_LADDERS[r] === ladder)
    const since = new Date(this.now() - ladder.decaySec * 1000)
    const recent = await this.db
      .select({ id: cooldowns.id })
      .from(cooldowns)
      .where(and(eq(cooldowns.steamId, steamId), inArray(cooldowns.reason, sameLadder), gt(cooldowns.createdAt, since)))
    const offence = recent.length + 1
    const endsAt = this.now() + cooldownSeconds(reason, offence) * 1000
    // A longer cooldown already running is kept
    const current = await this.active([steamId])
    const finalEnd = Math.max(endsAt, current.get(steamId)?.endsAt ?? 0)
    await this.db.insert(cooldowns).values({
      steamId,
      reason,
      matchId,
      offence,
      endsAt: new Date(finalEnd),
      createdAt: new Date(this.now()),
    })
    return { steamId, reason, endsAt: finalEnd }
  }

  // Longest running cooldown per player
  async active(steamIds: string[]): Promise<Map<string, ActiveCooldown>> {
    const out = new Map<string, ActiveCooldown>()
    if (steamIds.length === 0) return out
    const rows = await this.db
      .select({ steamId: cooldowns.steamId, reason: cooldowns.reason, endsAt: cooldowns.endsAt })
      .from(cooldowns)
      .where(and(inArray(cooldowns.steamId, steamIds), gt(cooldowns.endsAt, new Date(this.now()))))
      .orderBy(desc(cooldowns.endsAt))
    for (const r of rows) {
      if (!out.has(r.steamId)) out.set(r.steamId, { steamId: r.steamId, reason: r.reason, endsAt: r.endsAt.getTime() })
    }
    return out
  }
}
