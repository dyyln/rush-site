import { TtlCache } from "./cache.js"
import { FaceitUnavailableError } from "./errors.js"
import type { FaceitSignal, FetchLike, FetchResponseLike } from "./types.js"

export const FACEIT_DEFAULT_BASE_URL = "https://open.faceit.com/data/v4"
export const FACEIT_DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000

export type FaceitClientOptions = {
  apiKey: string
  fetch?: FetchLike
  baseUrl?: string
  // Set to 0 to disable caching.
  cacheTtlMs?: number
  cacheMaxEntries?: number
  timeoutMs?: number
  now?: () => number
}

export type FaceitClient = {
  lookupBySteamId(steamId64: string): Promise<FaceitSignal | null>
  clearCache(steamId64?: string): void
}

type PlayerResponse = {
  player_id?: string
  nickname?: string
  games?: Record<string, { skill_level?: number; faceit_elo?: number } | undefined>
}

type BanItem = {
  reason?: string
  type?: string
  starts_at?: string | null
  ends_at?: string | null
}

type BansResponse = { items?: BanItem[] }

type StatsResponse = { lifetime?: Record<string, unknown> }

const STEAM_ID_64 = /^\d{17}$/

export function createFaceitClient(opts: FaceitClientOptions): FaceitClient {
  if (!opts.apiKey) throw new TypeError("FACEIT apiKey is required")
  const fetchImpl = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch
  if (!fetchImpl) throw new TypeError("No fetch implementation available")
  const baseUrl = (opts.baseUrl ?? FACEIT_DEFAULT_BASE_URL).replace(/\/+$/, "")
  const now = opts.now ?? Date.now
  const timeoutMs = opts.timeoutMs ?? 10_000
  const cache = new TtlCache<FaceitSignal | null>(
    opts.cacheTtlMs ?? FACEIT_DEFAULT_CACHE_TTL_MS,
    opts.cacheMaxEntries ?? 10_000,
    now,
  )
  const inflight = new Map<string, Promise<FaceitSignal | null>>()

  async function request<T>(path: string): Promise<{ status: 404 } | { status: 200; body: T }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: FetchResponseLike
    try {
      res = await fetchImpl!(`${baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      })
    } catch (err) {
      const aborted = controller.signal.aborted
      throw new FaceitUnavailableError(aborted ? "FACEIT request timed out" : "FACEIT request failed", {
        reason: aborted ? "timeout" : "network",
        cause: err,
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 404) return { status: 404 }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"))
      throw new FaceitUnavailableError("FACEIT rate limit reached", {
        reason: "rate_limited",
        status: 429,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      })
    }
    if (res.status === 401 || res.status === 403) {
      throw new FaceitUnavailableError("FACEIT rejected the API key", { reason: "auth", status: res.status })
    }
    if (res.status >= 500) {
      throw new FaceitUnavailableError(`FACEIT server error ${res.status}`, {
        reason: "server_error",
        status: res.status,
      })
    }
    if (!res.ok) {
      throw new FaceitUnavailableError(`FACEIT unexpected status ${res.status}`, {
        reason: "bad_response",
        status: res.status,
      })
    }
    try {
      return { status: 200, body: (await res.json()) as T }
    } catch (err) {
      throw new FaceitUnavailableError("FACEIT returned invalid JSON", { reason: "bad_response", cause: err })
    }
  }

  async function fetchSignal(steamId64: string): Promise<FaceitSignal | null> {
    const query = new URLSearchParams({ game: "cs2", game_player_id: steamId64 })
    const playerRes = await request<PlayerResponse>(`/players?${query.toString()}`)
    if (playerRes.status === 404) return null
    const player = playerRes.body
    if (!player.player_id) {
      throw new FaceitUnavailableError("FACEIT player response had no player_id", { reason: "bad_response" })
    }
    const playerId = encodeURIComponent(player.player_id)

    const [bansRes, statsRes] = await Promise.all([
      request<BansResponse>(`/players/${playerId}/bans?offset=0&limit=100`),
      request<StatsResponse>(`/players/${playerId}/stats/cs2`),
    ])

    const bans = summarizeBans(bansRes.status === 200 ? (bansRes.body.items ?? []) : [], now())
    const activeBan = bans.active
    const cs2 = player.games?.["cs2"]
    const matchesPlayed = statsRes.status === 200 ? parseMatches(statsRes.body.lifetime) : undefined

    const signal: FaceitSignal = {
      faceitId: player.player_id,
      nickname: player.nickname ?? "",
      banned: activeBan !== undefined,
      pastBans: bans.pastCount,
      fetchedAt: new Date(now()).toISOString(),
    }
    if (activeBan?.reason) signal.banReason = activeBan.reason
    if (activeBan?.ends_at) signal.banEndsAt = activeBan.ends_at
    if (bans.lastEndedAt) signal.lastBanEndedAt = bans.lastEndedAt
    if (typeof cs2?.skill_level === "number") signal.skillLevel = cs2.skill_level
    if (typeof cs2?.faceit_elo === "number") signal.elo = cs2.faceit_elo
    if (matchesPlayed !== undefined) signal.matchesPlayed = matchesPlayed
    return signal
  }

  return {
    async lookupBySteamId(steamId64: string): Promise<FaceitSignal | null> {
      if (!STEAM_ID_64.test(steamId64)) throw new TypeError(`Invalid SteamID64: ${steamId64}`)
      const cached = cache.get(steamId64)
      if (cached.hit) return cached.value
      const pending = inflight.get(steamId64)
      if (pending) return pending
      const p = fetchSignal(steamId64)
        .then((signal) => {
          cache.set(steamId64, signal)
          return signal
        })
        .finally(() => inflight.delete(steamId64))
      inflight.set(steamId64, p)
      return p
    },
    clearCache(steamId64?: string): void {
      if (steamId64 === undefined) cache.clear()
      else cache.delete(steamId64)
    },
  }
}

// A ban with no end date is permanent. Permanent bans win over timed ones.
// Bans that have ended are counted separately. Bans not yet started are ignored.
function summarizeBans(
  items: BanItem[],
  nowMs: number,
): { active?: BanItem; pastCount: number; lastEndedAt?: string } {
  let active: BanItem | undefined
  let activeEnd = -Infinity
  let pastCount = 0
  let lastEndedAt: string | undefined
  let lastEnd = -Infinity
  for (const ban of items) {
    const end = ban.ends_at ? Date.parse(ban.ends_at) : Infinity
    if (Number.isNaN(end)) continue
    if (end <= nowMs) {
      pastCount++
      if (end > lastEnd) {
        lastEnd = end
        lastEndedAt = ban.ends_at ?? undefined
      }
      continue
    }
    const start = ban.starts_at ? Date.parse(ban.starts_at) : -Infinity
    if (start > nowMs) continue
    if (end > activeEnd) {
      active = ban
      activeEnd = end
    }
  }
  return {
    pastCount,
    ...(active ? { active } : {}),
    ...(lastEndedAt ? { lastEndedAt } : {}),
  }
}

function parseMatches(lifetime: Record<string, unknown> | undefined): number | undefined {
  const raw = lifetime?.["Matches"] ?? lifetime?.["Total Matches"]
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw.replace(/,/g, ""), 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
