import { DEMO_RECORDING_FLAG } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { adminAudit, featureFlags, users } from "../../db/schema.js"

const ROOT = "76561198900000001"
const PLAYER = "76561198900000003"

describe("admin demo recording routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}

  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ROOT } })
    await h.db.insert(users).values([
      { steamId: ROOT, displayName: "root" },
      { steamId: PLAYER, displayName: "player" },
    ])
    for (const id of [ROOT, PLAYER]) cookie[id] = h.app.signCookie(await h.ctx.sessions.create(id))
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await h.db.delete(featureFlags)
    await h.db.delete(adminAudit)
    h.ctx.flags.invalidate()
  })

  const as = (id: string | null) => {
    const cookies = id ? { cookies: { rs_sid: cookie[id]! } } : {}
    return {
      get: () => h.app.inject({ method: "GET", url: "/admin/demo-recording", ...cookies }),
      put: (payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: "/admin/demo-recording", payload, ...cookies }),
    }
  }

  it("answers 404 to non admins and changes nothing", async () => {
    expect((await as(PLAYER).get()).statusCode).toBe(404)
    expect((await as(PLAYER).put({ enabled: true })).statusCode).toBe(404)
    expect((await as(null).get()).statusCode).toBe(404)
    expect((await as(null).put({ enabled: true })).statusCode).toBe(404)
    expect(await h.ctx.flags.demoRecording()).toBe(false)
    expect(await h.db.select().from(featureFlags)).toHaveLength(0)
  })

  it("is off by default and reports S3 as a boolean only", async () => {
    const res = await as(ROOT).get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ enabled: false, s3Configured: false, updatedBy: null, updatedAt: null })
  })

  it("toggles the setting and writes an audit row each time", async () => {
    const on = await as(ROOT).put({ enabled: true })
    expect(on.statusCode).toBe(200)
    expect(on.json().setting).toMatchObject({ enabled: true, s3Configured: false, updatedBy: ROOT })
    expect(on.json().audit).toMatchObject({ action: "demo_recording.set", adminSteamId: ROOT, target: DEMO_RECORDING_FLAG })
    expect(await h.ctx.flags.demoRecording()).toBe(true)
    expect((await as(ROOT).get()).json().enabled).toBe(true)

    const off = await as(ROOT).put({ enabled: false })
    expect(off.json().setting.enabled).toBe(false)
    expect(await h.ctx.flags.demoRecording()).toBe(false)

    const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.action, "demo_recording.set"))
    expect(audit.map((a) => (a.payload as { enabled: boolean; before: boolean }).enabled)).toEqual([true, false])
    expect(audit.map((a) => (a.payload as { enabled: boolean; before: boolean }).before)).toEqual([false, true])
  })

  it("rejects a body without a boolean", async () => {
    const res = await as(ROOT).put({ enabled: "yes" })
    expect(res.statusCode).toBe(400)
    expect(await h.db.select().from(featureFlags)).toHaveLength(0)
  })
})
