import type { TrustLevel } from "@rushsite/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { bans, trustLevels } from "../../db/schema.js"
import type { SessionStore } from "../auth/session.js"
import type { PartyService } from "../parties/service.js"
import type { QueueService } from "../queue/service.js"
import type { RatingService, RollbackSummary } from "../rating/service.js"
import type { BanGate } from "./ban-gate.js"
import type { TrustService } from "./service.js"

export type BanOptions = {
  until?: Date
  bannedBy?: string
  // Defaults to true for permanent bans, which are for confirmed cheating
  rollback?: boolean
}

export class BanService {
  constructor(
    private readonly db: Db,
    private readonly ratings: RatingService,
    private readonly trust: TrustService,
    private readonly queue: QueueService,
    private readonly parties: PartyService,
    private readonly sessions: SessionStore,
    private readonly now: () => number,
    private readonly rollbackWindowDays: number,
    private readonly gate?: BanGate,
    private readonly disconnect?: (steamId: string, reason: string) => void,
    // Runs after a ban or unban, for example to take the Discord role
    private readonly onChange?: (steamId: string) => void,
  ) {}

  async ban(steamId: string, reason: string, opts: BanOptions = {}): Promise<{ banId: string; rollback: RollbackSummary | null }> {
    const rollback = opts.rollback ?? !opts.until
    const from = new Date(this.now() - this.rollbackWindowDays * 86400_000)
    const [row] = await this.db
      .insert(bans)
      .values({
        steamId,
        reason,
        bannedBy: opts.bannedBy ?? null,
        expiresAt: opts.until ?? null,
        rollbackFrom: rollback ? from : null,
      })
      .returning({ id: bans.id })
    // The marker goes first so requests already in flight are refused too
    await this.gate?.mark(steamId, { reason, until: opts.until ? opts.until.toISOString() : null })
    // Signs the player out everywhere so the ban takes effect at once
    await this.sessions.destroyAll(steamId)
    this.disconnect?.(steamId, "banned")
    const party = await this.parties.partyOf(steamId)
    if (party) await this.queue.cancelParty(party.partyId, "banned")
    const summary = rollback ? await this.ratings.rollbackCheater(steamId, from) : null
    await this.trust.recompute(steamId)
    this.onChange?.(steamId)
    return { banId: row!.id, rollback: summary }
  }

  async unban(steamId: string): Promise<number> {
    const rows = await this.db
      .update(bans)
      .set({ revokedAt: new Date(this.now()) })
      .where(and(eq(bans.steamId, steamId), isNull(bans.revokedAt)))
      .returning({ id: bans.id })
    await this.gate?.clear(steamId)
    await this.trust.recompute(steamId)
    this.onChange?.(steamId)
    return rows.length
  }

  // Admin override. Locked levels are left alone by automatic evaluation
  async setTrustLevel(steamId: string, level: TrustLevel, locked = true): Promise<void> {
    await this.db
      .insert(trustLevels)
      .values({ steamId, level, reason: "admin", locked })
      .onConflictDoUpdate({ target: trustLevels.steamId, set: { level, reason: "admin", locked, updatedAt: sql`now()` } })
  }
}
