import { isFaceitUnavailableError, type FaceitSignal } from "@rushsite/faceit"
import type { TrustLevel, TrustLevelsResponse, TrustProgress } from "@rushsite/shared"
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Db } from "../../db/client.js"
import { bans, flags, matchPlayers, matches, steamProfiles, trustLevels, trustSignals } from "../../db/schema.js"
import type { SteamBans, SteamWebApi } from "../auth/steam.js"
import {
  evaluateTrust,
  steamBanCount,
  trustLevels as trustLevelDefinitions,
  trustProgress,
  type TrustConfig,
  type TrustEvaluation,
  type TrustInputs,
} from "./evaluate.js"

export type FaceitLookup = (steamId64: string) => Promise<FaceitSignal | null>

export class TrustService {
  constructor(
    private readonly db: Db,
    private readonly steam: SteamWebApi,
    // undefined when FACEIT_API_KEY is not set
    private readonly faceit: FaceitLookup | undefined,
    private readonly cfg: TrustConfig,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  // Fetches fresh external signals and stores them. Failures are recorded as unknown, never as negative
  async refreshSignals(steamId: string): Promise<void> {
    if (this.steam.enabled) {
      try {
        const b = await this.steam.playerBans(steamId)
        await this.db.insert(trustSignals).values({
          steamId,
          source: "steam_bans",
          clean: !b || (steamBanCount(b) === 0 && !b.CommunityBanned),
          data: b ?? { missing: true },
        })
      } catch (err) {
        this.log.warn({ err, steamId }, "steam ban lookup failed")
      }
    }
    if (this.faceit) {
      try {
        const signal = await this.faceit(steamId)
        await this.db.insert(trustSignals).values({
          steamId,
          source: "faceit",
          clean: !signal || !signal.banned,
          data: signal ?? { account: false },
        })
      } catch (err) {
        if (isFaceitUnavailableError(err) && err.reason === "auth") {
          this.log.error({ err, steamId }, "FACEIT API key rejected. Trust checks run without FACEIT")
        } else {
          this.log.warn({ err, steamId }, "faceit lookup failed")
        }
      }
    }
  }

  private async latestSignal(steamId: string, source: string): Promise<unknown | undefined> {
    const [row] = await this.db
      .select({ data: trustSignals.data })
      .from(trustSignals)
      .where(and(eq(trustSignals.steamId, steamId), eq(trustSignals.source, source)))
      .orderBy(desc(trustSignals.fetchedAt))
      .limit(1)
    return row?.data
  }

  async inputs(steamId: string): Promise<TrustInputs> {
    const steamRaw = (await this.latestSignal(steamId, "steam_bans")) as (SteamBans & { missing?: boolean }) | undefined
    const faceitRaw = (await this.latestSignal(steamId, "faceit")) as (FaceitSignal & { account?: false }) | undefined
    const [profile] = await this.db
      .select({ created: steamProfiles.accountCreatedAt, playtime: steamProfiles.cs2PlaytimeMinutes })
      .from(steamProfiles)
      .where(eq(steamProfiles.steamId, steamId))
    const [completed] = await this.db
      .select({ n: count() })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.steamId, steamId), eq(matches.status, "finished"), eq(matchPlayers.abandoned, false)))
    const flagRows = await this.db
      .select({ status: flags.status, n: count() })
      .from(flags)
      .where(eq(flags.steamId, steamId))
      .groupBy(flags.status)
    const activeBan = (await this.activeBans([steamId])).has(steamId)
    return {
      steamBans: steamRaw === undefined ? "unknown" : steamRaw.missing ? null : steamRaw,
      faceit: faceitRaw === undefined ? "unknown" : faceitRaw.account === false ? null : faceitRaw,
      accountCreatedAt: profile?.created ?? null,
      cs2PlaytimeMinutes: profile?.playtime ?? null,
      platform: {
        completedMatches: completed?.n ?? 0,
        openFlags: flagRows.filter((f) => f.status === "open" || f.status === "reviewing").reduce((n, f) => n + f.n, 0),
        confirmedFlags: flagRows.find((f) => f.status === "confirmed")?.n ?? 0,
        activeBan,
      },
    }
  }

  // Re-evaluates from stored signals and writes the level unless an admin locked it
  async recompute(steamId: string): Promise<TrustEvaluation> {
    const result = evaluateTrust(await this.inputs(steamId), this.cfg, this.now())
    await this.db
      .insert(trustLevels)
      .values({ steamId, level: result.level, reason: result.reasons.join(",") })
      .onConflictDoUpdate({
        target: trustLevels.steamId,
        set: { level: result.level, reason: result.reasons.join(","), updatedAt: sql`now()` },
        setWhere: eq(trustLevels.locked, false),
      })
    return result
  }

  // Progress toward the next level for the player themselves
  async progress(steamId: string): Promise<TrustProgress> {
    const [row] = await this.db.select().from(trustLevels).where(eq(trustLevels.steamId, steamId))
    return trustProgress(row?.level ?? "new", await this.inputs(steamId), this.cfg, this.now(), { locked: row?.locked ?? false })
  }

  levelDefinitions(): TrustLevelsResponse {
    return trustLevelDefinitions(this.cfg)
  }

  async onLogin(steamId: string): Promise<void> {
    await this.refreshSignals(steamId)
    await this.recompute(steamId)
  }

  async recomputeMany(steamIds: string[]): Promise<void> {
    for (const id of steamIds) {
      try {
        await this.recompute(id)
      } catch (err) {
        this.log.warn({ err, steamId: id }, "trust recompute failed")
      }
    }
  }

  async levels(steamIds: string[]): Promise<Record<string, TrustLevel>> {
    const out: Record<string, TrustLevel> = {}
    for (const id of steamIds) out[id] = "new"
    if (steamIds.length === 0) return out
    const rows = await this.db
      .select({ steamId: trustLevels.steamId, level: trustLevels.level })
      .from(trustLevels)
      .where(inArray(trustLevels.steamId, steamIds))
    for (const r of rows) out[r.steamId] = r.level
    return out
  }

  async activeBans(steamIds: string[]): Promise<Set<string>> {
    if (steamIds.length === 0) return new Set()
    const rows = await this.db
      .select({ steamId: bans.steamId })
      .from(bans)
      .where(
        and(
          inArray(bans.steamId, steamIds),
          isNull(bans.revokedAt),
          or(isNull(bans.expiresAt), gt(bans.expiresAt, new Date(this.now()))),
        ),
      )
    return new Set(rows.map((r) => r.steamId))
  }
}
