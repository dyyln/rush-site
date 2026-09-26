import { and, desc, eq } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Redis } from "ioredis"
import type { Db } from "../../db/client.js"
import { trustSignals } from "../../db/schema.js"
import type { FetchFn } from "../auth/steam.js"
import type { FaceitLookup } from "../trust/service.js"

const LEETIFY_API = "https://api-public.cs-prod.leetify.com"
// Leetify asks apps not to store its data, so this is a short request cache only
const CACHE_SEC = 3600
// Shorter for failures so a Leetify outage clears up soon
const FAIL_CACHE_SEC = 15 * 60

export type ExternalRanks = {
  faceit: { level: number | null; elo: number | null; nickname: string | null } | null
  // Premier CS Rating, null when unranked this season
  premier: number | null
  // Wingman skill group, 1 is Silver I and 18 is Global Elite
  wingman: number | null
  // Present when Leetify knows the player. The site links there as the source
  leetify: { url: string } | null
}

type LeetifyProfile = {
  privacy_mode?: string
  ranks?: { premier?: number | null; wingman?: number | null; faceit?: number | null; faceit_elo?: number | null }
}

type Cached = { leetify: LeetifyProfile | null; failed?: boolean }

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

// FACEIT from our own lookup when there is one, Premier and Wingman from Leetify
export class ExternalRanksService {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly fetchFn: FetchFn,
    private readonly log: FastifyBaseLogger,
    private readonly leetifyKey?: string,
    private readonly faceit?: FaceitLookup,
  ) {}

  async get(steamId: string): Promise<ExternalRanks> {
    const [leetify, faceit] = await Promise.all([this.leetify(steamId), this.faceitSignal(steamId)])
    const r = leetify?.ranks
    const level = positive(faceit?.skillLevel) ?? positive(r?.faceit)
    const elo = positive(faceit?.elo) ?? positive(r?.faceit_elo)
    return {
      faceit: level || elo || faceit?.nickname ? { level, elo, nickname: faceit?.nickname ?? null } : null,
      premier: positive(r?.premier),
      wingman: positive(r?.wingman),
      leetify: leetify ? { url: `https://leetify.com/app/profile/${steamId}` } : null,
    }
  }

  // A live lookup when FACEIT is configured, the client caches it. Otherwise the one stored at sign in
  private async faceitSignal(steamId: string): Promise<{ nickname?: string; skillLevel?: number; elo?: number } | null> {
    if (this.faceit) {
      try {
        return await this.faceit(steamId)
      } catch (err) {
        this.log.warn({ err, steamId }, "faceit lookup failed")
      }
    }
    const [row] = await this.db
      .select({ data: trustSignals.data })
      .from(trustSignals)
      .where(and(eq(trustSignals.steamId, steamId), eq(trustSignals.source, "faceit")))
      .orderBy(desc(trustSignals.fetchedAt))
      .limit(1)
    const data = row?.data as { faceitId?: string; nickname?: string; skillLevel?: number; elo?: number } | undefined
    return data?.faceitId ? data : null
  }

  private async leetify(steamId: string): Promise<LeetifyProfile | null> {
    const key = `ext:leetify:${steamId}`
    const hit = await this.redis.get(key)
    if (hit) return (JSON.parse(hit) as Cached).leetify
    let cached: Cached
    try {
      const headers: Record<string, string> = { accept: "application/json" }
      if (this.leetifyKey) headers._leetify_key = this.leetifyKey
      const res = await this.fetchFn(`${LEETIFY_API}/v3/profile?steam64_id=${steamId}`, { headers, signal: AbortSignal.timeout(5000) })
      if (res.status === 404) cached = { leetify: null }
      else if (!res.ok) throw new Error(`leetify ${res.status}`)
      else {
        const body = (await res.json()) as LeetifyProfile
        // Keep only what the site shows
        cached = { leetify: { privacy_mode: body.privacy_mode, ranks: body.ranks ?? {} } }
      }
    } catch (err) {
      this.log.warn({ err, steamId }, "leetify lookup failed")
      cached = { leetify: null, failed: true }
    }
    await this.redis.set(key, JSON.stringify(cached), "EX", cached.failed ? FAIL_CACHE_SEC : CACHE_SEC)
    return cached.leetify
  }
}
