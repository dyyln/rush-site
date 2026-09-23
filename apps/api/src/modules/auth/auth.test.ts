import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { safeRedirectPath } from "./routes.js"
import { buildLoginUrl, checkAssertion, STEAM_OPENID_ENDPOINT } from "./steam.js"

const SID = "76561197960287930"
const NOW = Date.parse("2026-09-23T12:00:00Z")

function assertion(returnTo: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${SID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${SID}`,
    "openid.return_to": returnTo,
    "openid.response_nonce": "2026-09-23T12:00:00ZAbCdEf",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  }
}

describe("steam openid checks", () => {
  const rt = "http://localhost:3001/auth/steam/callback?state=abc"

  it("builds a checkid_setup url with identifier_select", () => {
    const url = new URL(buildLoginUrl("http://localhost:3001", rt))
    expect(url.origin + url.pathname).toBe(STEAM_OPENID_ENDPOINT)
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup")
    expect(url.searchParams.get("openid.return_to")).toBe(rt)
  })

  it("accepts a well formed assertion", () => {
    expect(checkAssertion(assertion(rt), rt, NOW)).toEqual({ ok: true, steamId: SID, nonce: "2026-09-23T12:00:00ZAbCdEf" })
  })

  it("rejects forged endpoints, identities, return urls and stale nonces", () => {
    expect(checkAssertion(assertion(rt, { "openid.op_endpoint": "https://evil.example/openid/login" }), rt, NOW)).toMatchObject({ ok: false })
    expect(
      checkAssertion(assertion(rt, { "openid.claimed_id": "https://evil.example/openid/id/76561197960287930" }), rt, NOW),
    ).toMatchObject({ ok: false })
    expect(checkAssertion(assertion("http://localhost:3001/auth/steam/callback?state=zzz"), rt, NOW)).toMatchObject({
      ok: false,
      reason: "return_to",
    })
    expect(checkAssertion(assertion(rt), rt, NOW + 10 * 60_000)).toMatchObject({ ok: false, reason: "nonce_age" })
    expect(checkAssertion(assertion(rt, { "openid.signed": "op_endpoint" }), rt, NOW)).toMatchObject({ ok: false })
  })

  it("only allows relative redirect paths", () => {
    expect(safeRedirectPath("/play")).toBe("/play")
    expect(safeRedirectPath("//evil.example")).toBe("/")
    expect(safeRedirectPath("https://evil.example")).toBe("/")
  })
})

describe("login flow", () => {
  const steamCalls: string[] = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    steamCalls.push(url)
    if (url === STEAM_OPENID_ENDPOINT) {
      const body = new URLSearchParams(String(init?.body))
      const ok = body.get("openid.mode") === "check_authentication" && body.get("openid.sig") === "c2lnbmF0dXJl"
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${ok}\n`)
    }
    if (url.includes("GetPlayerSummaries")) {
      return Response.json({ response: { players: [{ steamid: SID, personaname: "Maximus", avatarfull: "https://a/b.jpg" }] } })
    }
    if (url.includes("GetOwnedGames")) return Response.json({ response: { games: [{ appid: 730, playtime_forever: 9000 }] } })
    if (url.includes("GetPlayerBans")) {
      return Response.json({
        players: [
          { SteamId: SID, CommunityBanned: false, VACBanned: false, NumberOfVACBans: 0, DaysSinceLastBan: 0, NumberOfGameBans: 0, EconomyBan: "none" },
        ],
      })
    }
    return new Response("not found", { status: 404 })
  }) as typeof fetch

  let h: Awaited<ReturnType<typeof createAppHarness>>
  beforeAll(async () => {
    h = await createAppHarness({ fetch: fakeFetch, env: { STEAM_API_KEY: "test-key" } })
    h.clock.t = NOW
  })
  afterAll(async () => {
    await h.close()
  })

  it("redirects to steam, verifies the callback, sets a session and serves /me", async () => {
    const start = await h.app.inject({ method: "GET", url: "/auth/steam?returnTo=/play" })
    expect(start.statusCode).toBe(302)
    const steamUrl = new URL(start.headers.location as string)
    const returnTo = steamUrl.searchParams.get("openid.return_to")!
    const loginCookie = start.cookies.find((c) => c.name === "rs_login")!
    const callback = new URL(returnTo)
    for (const [k, v] of Object.entries(assertion(returnTo))) callback.searchParams.set(k, v)

    const res = await h.app.inject({
      method: "GET",
      url: callback.pathname + callback.search,
      cookies: { rs_login: loginCookie.value },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("http://localhost:3000/play")
    const session = res.cookies.find((c) => c.name === "rs_sid")
    expect(session?.httpOnly).toBe(true)
    expect(steamCalls).toContain(STEAM_OPENID_ENDPOINT)

    const me = await h.app.inject({ method: "GET", url: "/me", cookies: { rs_sid: session!.value } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({
      user: { steamId: SID, displayName: "Maximus", avatarUrl: "https://a/b.jpg", trustLevel: "new", region: "eu", isAdmin: false },
    })

    // The same assertion cannot be replayed
    const replay = await h.app.inject({
      method: "GET",
      url: callback.pathname + callback.search,
      cookies: { rs_login: loginCookie.value },
    })
    expect(replay.headers.location).toContain("error=nonce_replayed")
  })

  it("rejects a callback without the login state cookie", async () => {
    const res = await h.app.inject({ method: "GET", url: "/auth/steam/callback?state=x" })
    expect(res.headers.location).toContain("error=state_missing")
  })

  it("rejects /me without a session", async () => {
    expect((await h.app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401)
  })
})
