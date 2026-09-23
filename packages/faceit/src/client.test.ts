import { describe, expect, it } from "vitest"
import { createFaceitClient, FaceitUnavailableError, isFaceitUnavailableError, signalToTrustDelta } from "./index.js"
import type { FetchLike } from "./index.js"

const STEAM_ID = "76561198000000001"
const PLAYER_ID = "11111111-2222-3333-4444-555555555555"
const NOW = Date.parse("2026-09-23T12:00:00Z")

type Route = { status: number; body?: unknown; headers?: Record<string, string> }

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; auth: string | undefined }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, auth: init?.headers?.["Authorization"] })
    const path = url.replace("https://open.faceit.com/data/v4", "").split("?")[0]!
    const route = routes[path] ?? { status: 404, body: { errors: [] } }
    const headers = new Map(Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      json: async () => route.body,
    }
  }
  return { fetch, calls }
}

const playerRoute: Route = {
  status: 200,
  body: {
    player_id: PLAYER_ID,
    nickname: "s1mpleton",
    games: { cs2: { skill_level: 8, faceit_elo: 1850, game_player_id: STEAM_ID } },
  },
}
const statsRoute: Route = { status: 200, body: { lifetime: { Matches: "742", "Win Rate %": "53" } } }
const noBans: Route = { status: 200, body: { items: [], start: 0, end: 100 } }

function client(routes: Record<string, Route>, extra: { cacheTtlMs?: number; now?: () => number } = {}) {
  const f = fakeFetch(routes)
  const c = createFaceitClient({ apiKey: "test-key", fetch: f.fetch, now: extra.now ?? (() => NOW), ...extra })
  return { c, calls: f.calls }
}

describe("lookupBySteamId", () => {
  it("returns a signal for a found player", async () => {
    const { c, calls } = client({
      "/players": playerRoute,
      [`/players/${PLAYER_ID}/bans`]: noBans,
      [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
    })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal).toEqual({
      faceitId: PLAYER_ID,
      nickname: "s1mpleton",
      banned: false,
      pastBans: 0,
      skillLevel: 8,
      elo: 1850,
      matchesPlayed: 742,
      fetchedAt: "2026-09-23T12:00:00.000Z",
    })
    expect(calls[0]!.url).toBe(
      `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${STEAM_ID}`,
    )
    expect(calls.every((call) => call.auth === "Bearer test-key")).toBe(true)
    expect(signalToTrustDelta(signal)).toBeGreaterThan(0)
  })

  it("returns null when the player is not on FACEIT", async () => {
    const { c, calls } = client({ "/players": { status: 404, body: { errors: [] } } })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal).toBeNull()
    expect(calls).toHaveLength(1)
    expect(signalToTrustDelta(signal)).toBe(0)
  })

  it("leaves matchesPlayed unset when there are no cs2 stats", async () => {
    const { c } = client({ "/players": playerRoute, [`/players/${PLAYER_ID}/bans`]: noBans })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal?.matchesPlayed).toBeUndefined()
    expect(signalToTrustDelta(signal)).toBe(0)
  })

  it("flags an active ban", async () => {
    const { c } = client({
      "/players": playerRoute,
      [`/players/${PLAYER_ID}/bans`]: {
        status: 200,
        body: {
          items: [
            { reason: "toxic", type: "chat", starts_at: "2025-01-01T00:00:00Z", ends_at: "2025-01-08T00:00:00Z" },
            { reason: "cheating", type: "platform", starts_at: "2026-09-01T00:00:00Z", ends_at: null },
          ],
        },
      },
      [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
    })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal?.banned).toBe(true)
    expect(signal?.banReason).toBe("cheating")
    expect(signal?.banEndsAt).toBeUndefined()
    expect(signal?.pastBans).toBe(1)
    expect(signal?.lastBanEndedAt).toBe("2025-01-08T00:00:00Z")
    expect(signalToTrustDelta(signal)).toBe(-100)
  })

  it("reports the end date of a timed ban", async () => {
    const { c } = client({
      "/players": playerRoute,
      [`/players/${PLAYER_ID}/bans`]: {
        status: 200,
        body: { items: [{ reason: "afk", starts_at: "2026-09-20T00:00:00Z", ends_at: "2026-09-30T00:00:00Z" }] },
      },
      [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
    })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal?.banned).toBe(true)
    expect(signal?.banEndsAt).toBe("2026-09-30T00:00:00Z")
  })

  it("counts expired bans as past bans, not active", async () => {
    const { c } = client({
      "/players": playerRoute,
      [`/players/${PLAYER_ID}/bans`]: {
        status: 200,
        body: {
          items: [
            { reason: "toxic", starts_at: "2025-01-01T00:00:00Z", ends_at: "2025-01-08T00:00:00Z" },
            { reason: "cheating", starts_at: "2025-06-01T00:00:00Z", ends_at: "2026-06-01T00:00:00Z" },
          ],
        },
      },
      [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
    })
    const signal = await c.lookupBySteamId(STEAM_ID)
    expect(signal?.banned).toBe(false)
    expect(signal?.banReason).toBeUndefined()
    expect(signal?.pastBans).toBe(2)
    expect(signal?.lastBanEndedAt).toBe("2026-06-01T00:00:00Z")
    expect(signalToTrustDelta(signal)).toBe(-25)
  })

  it("throws FaceitUnavailableError when rate limited", async () => {
    const { c } = client({ "/players": { status: 429, headers: { "Retry-After": "30" } } })
    const err = await c.lookupBySteamId(STEAM_ID).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceitUnavailableError)
    expect(isFaceitUnavailableError(err)).toBe(true)
    expect(err).toMatchObject({ reason: "rate_limited", status: 429, retryAfterSeconds: 30 })
  })

  it("throws FaceitUnavailableError when a follow-up call is rate limited", async () => {
    const { c } = client({
      "/players": playerRoute,
      [`/players/${PLAYER_ID}/bans`]: { status: 429 },
      [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
    })
    await expect(c.lookupBySteamId(STEAM_ID)).rejects.toMatchObject({ reason: "rate_limited" })
  })

  it("throws FaceitUnavailableError on 5xx and network errors", async () => {
    const { c } = client({ "/players": { status: 503 } })
    await expect(c.lookupBySteamId(STEAM_ID)).rejects.toMatchObject({
      name: "FaceitUnavailableError",
      reason: "server_error",
      status: 503,
    })

    const broken = createFaceitClient({
      apiKey: "k",
      fetch: async () => {
        throw new Error("ECONNRESET")
      },
    })
    await expect(broken.lookupBySteamId(STEAM_ID)).rejects.toMatchObject({ reason: "network" })
  })

  it("rejects an invalid steam id", async () => {
    const { c, calls } = client({})
    await expect(c.lookupBySteamId("abc")).rejects.toBeInstanceOf(TypeError)
    expect(calls).toHaveLength(0)
  })
})

describe("cache", () => {
  const routes = {
    "/players": playerRoute,
    [`/players/${PLAYER_ID}/bans`]: noBans,
    [`/players/${PLAYER_ID}/stats/cs2`]: statsRoute,
  }

  it("serves repeat lookups from cache until the TTL passes", async () => {
    let t = NOW
    const { c, calls } = client(routes, { now: () => t })
    await c.lookupBySteamId(STEAM_ID)
    await c.lookupBySteamId(STEAM_ID)
    expect(calls).toHaveLength(3)
    t += 6 * 60 * 60 * 1000 - 1
    await c.lookupBySteamId(STEAM_ID)
    expect(calls).toHaveLength(3)
    t += 1
    await c.lookupBySteamId(STEAM_ID)
    expect(calls).toHaveLength(6)
  })

  it("caches not-found results", async () => {
    const { c, calls } = client({})
    expect(await c.lookupBySteamId(STEAM_ID)).toBeNull()
    expect(await c.lookupBySteamId(STEAM_ID)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("does not cache errors", async () => {
    const { c, calls } = client({ "/players": { status: 429 } })
    await expect(c.lookupBySteamId(STEAM_ID)).rejects.toBeInstanceOf(FaceitUnavailableError)
    await expect(c.lookupBySteamId(STEAM_ID)).rejects.toBeInstanceOf(FaceitUnavailableError)
    expect(calls).toHaveLength(2)
  })

  it("shares one request between concurrent lookups", async () => {
    const { c, calls } = client(routes)
    await Promise.all([c.lookupBySteamId(STEAM_ID), c.lookupBySteamId(STEAM_ID)])
    expect(calls).toHaveLength(3)
  })

  it("can be disabled and cleared", async () => {
    const off = client(routes, { cacheTtlMs: 0 })
    await off.c.lookupBySteamId(STEAM_ID)
    await off.c.lookupBySteamId(STEAM_ID)
    expect(off.calls).toHaveLength(6)

    const on = client(routes)
    await on.c.lookupBySteamId(STEAM_ID)
    on.c.clearCache(STEAM_ID)
    await on.c.lookupBySteamId(STEAM_ID)
    expect(on.calls).toHaveLength(6)
  })
})
