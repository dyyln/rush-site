import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAppHarness } from "../../test/helpers.js"
import { EnvSchema, productionProblems } from "../env.js"
import { CLOSE_SESSION_ENDED, LocalHub } from "../modules/ws/hub.js"
import { ConnectionCounter, TokenBucket } from "./security.js"

const WEB = "http://localhost:3000"

describe("http hardening", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  beforeAll(async () => {
    h = await createAppHarness()
  })
  afterAll(async () => {
    await h.close()
  })

  it("refuses state changes from other origins", async () => {
    const evil = await h.app.inject({ method: "POST", url: "/auth/logout", headers: { origin: "https://evil.dyyln.dev" } })
    expect(evil.statusCode).toBe(403)
    expect(evil.json()).toMatchObject({ error: "bad_origin" })
    const nullOrigin = await h.app.inject({ method: "POST", url: "/parties/leave", headers: { origin: "null" } })
    expect(nullOrigin.statusCode).toBe(403)
    const fetchMeta = await h.app.inject({ method: "POST", url: "/auth/logout", headers: { "sec-fetch-site": "cross-site" } })
    expect(fetchMeta.statusCode).toBe(403)
  })

  it("lets the website and tools through", async () => {
    expect((await h.app.inject({ method: "POST", url: "/auth/logout", headers: { origin: WEB } })).statusCode).toBe(204)
    expect((await h.app.inject({ method: "POST", url: "/auth/logout" })).statusCode).toBe(204)
    // Reads are never blocked
    expect((await h.app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } })).statusCode).toBe(200)
  })

  it("leaves signed webhooks to their own check", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/webhooks/match/00000000-0000-4000-8000-000000000000",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      payload: "{}",
    })
    expect(res.statusCode).toBe(404)
  })

  it("refuses sockets opened from other origins", async () => {
    const res = await h.app.inject({ method: "GET", url: "/ws", headers: { origin: "https://evil.example" } })
    expect(res.statusCode).toBe(403)
  })

  it("refuses sockets without a session", async () => {
    const res = await h.app.inject({ method: "GET", url: "/ws", headers: { origin: WEB } })
    expect(res.statusCode).toBe(401)
  })

  it("sends security headers", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" })
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(res.headers["strict-transport-security"]).toBeDefined()
  })
})

describe("rate limits", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  beforeAll(async () => {
    h = await createAppHarness({ env: { RATE_LIMIT_ENABLED: "true" } })
  })
  afterAll(async () => {
    await h.close()
  })

  it("limits the login start per IP", async () => {
    const codes: number[] = []
    for (let i = 0; i < 21; i++) codes.push((await h.app.inject({ method: "GET", url: "/auth/steam" })).statusCode)
    expect(codes.slice(0, 20).every((c) => c === 302)).toBe(true)
    expect(codes[20]).toBe(429)
    const last = await h.app.inject({ method: "GET", url: "/auth/steam" })
    expect(last.json()).toMatchObject({ error: "rate_limited" })
    expect(last.headers["retry-after"]).toBeDefined()
  })

  it("keeps separate buckets per IP and never limits health", async () => {
    const other = await h.app.inject({ method: "GET", url: "/auth/steam", remoteAddress: "10.9.8.7" })
    expect(other.statusCode).toBe(302)
    const health = await h.app.inject({ method: "GET", url: "/health" })
    expect(health.headers["x-ratelimit-limit"]).toBeUndefined()
  })

  it("applies the global limit to unlisted routes", async () => {
    const res = await h.app.inject({ method: "GET", url: "/modes" })
    expect(res.headers["x-ratelimit-limit"]).toBe("600")
  })
})

describe("production env", () => {
  const base = { NODE_ENV: "production", RATE_LIMIT_ENABLED: "true", SESSION_SECRET: "x".repeat(32) } as const
  const prodEnv = (over: Record<string, string>) => EnvSchema.parse({ ...base, ...over })

  it("rejects the example secrets", () => {
    const env = prodEnv({ SESSION_SECRET: "change-me-dev-session-secret-at-least-32-chars" })
    const problems = productionProblems(env)
    expect(problems.some((p) => p.startsWith("SESSION_SECRET"))).toBe(true)
    expect(problems.some((p) => p.startsWith("RUSHSITE_AGENT_TOKEN"))).toBe(true)
  })

  it("accepts random secrets", () => {
    const env = prodEnv({
      SESSION_SECRET: "4f9c2b7e1d8a6035c9e4b1f7a2d8c6e05b3f9a1c7e2d4b8f6a0c3e5d7b9f1a2c",
      RUSHSITE_AGENT_TOKEN: "9b1e7c3a5f2d8e4c6a0b9d7f1e3c5a2b",
    })
    expect(productionProblems(env)).toEqual([])
  })

  it("does not let rate limits be switched off", () => {
    const env = prodEnv({ RATE_LIMIT_ENABLED: "false" })
    expect(productionProblems(env)).toContain("RATE_LIMIT_ENABLED must stay on in production")
  })
})

describe("socket limits", () => {
  it("refills the message bucket over time", () => {
    let t = 0
    const bucket = new TokenBucket(3, 1, () => t)
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false])
    t = 1000
    expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
  })

  it("caps open sockets per key", () => {
    const c = new ConnectionCounter()
    expect(c.tryOpen("u:1", 2)).toBe(true)
    expect(c.tryOpen("u:1", 2)).toBe(true)
    expect(c.tryOpen("u:1", 2)).toBe(false)
    c.close("u:1")
    expect(c.tryOpen("u:1", 2)).toBe(true)
  })
})

describe("session end", () => {
  it("closes every socket of the user with 4001 and leaves others open", () => {
    const hub = new LocalHub()
    const sock = () => ({ readyState: 1, closed: null as number | null, send() {}, close(code?: number) { this.closed = code ?? null } })
    const [a1, a2, b] = [sock(), sock(), sock()]
    hub.add("76561198000000001", a1)
    hub.add("76561198000000001", a2)
    hub.add("76561198000000002", b)
    hub.deliver({ kind: "disconnect", steamIds: ["76561198000000001"], reason: "banned" }, { type: "session_ended", payload: {}, ts: 1 })
    expect([a1.closed, a2.closed, b.closed]).toEqual([CLOSE_SESSION_ENDED, CLOSE_SESSION_ENDED, null])
  })
})
