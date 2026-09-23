import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { adminAudit, users } from "../../db/schema.js"

const ADMIN = "76561198999999998"
type H = Awaited<ReturnType<typeof createAppHarness>>
let h: H

afterEach(async () => {
  await h?.close()
})

async function setup() {
  h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ADMIN } })
  await h.db.insert(users).values({ steamId: ADMIN, displayName: "boss" })
  const cookie = h.app.signCookie(await h.ctx.sessions.create(ADMIN))
  const as = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: { rs_sid: cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) })
  return { as }
}

async function joinError(steamId: string, modes: ("aim1v1" | "aim2v2" | "rush3v3")[]) {
  try {
    await h.ctx.queue.join(steamId, modes)
    return null
  } catch (e) {
    return e as { statusCode: number; code: string }
  }
}

describe("queue open flags", () => {
  it("refuses joins for a closed mode, reports it on /status and reopens", async () => {
    const { as } = await setup()
    const [a, b] = await makeUsers(h.db, 2)

    const closed = await as("PUT", "/admin/flags/queue.aim1v1.open", { enabled: false })
    expect(closed.statusCode).toBe(200)
    expect(closed.json()).toMatchObject({ flag: { key: "queue.aim1v1.open", enabled: false, updatedBy: ADMIN }, drained: 0 })

    expect(await joinError(a!, ["aim1v1"])).toMatchObject({ statusCode: 503, code: "mode_closed" })
    // One closed mode refuses the whole join
    expect(await joinError(a!, ["aim1v1", "rush3v3"])).toMatchObject({ statusCode: 503, code: "mode_closed" })
    expect(await joinError(b!, ["rush3v3"])).toBeNull()

    const status = (await h.app.inject({ method: "GET", url: "/status" })).json() as { modes: { mode: string; available: boolean; reason?: string }[] }
    expect(status.modes.find((m) => m.mode === "aim1v1")).toEqual({ mode: "aim1v1", available: false, reason: "closed" })
    expect(status.modes.find((m) => m.mode === "rush3v3")?.reason).not.toBe("closed")

    // Disabled flags stay out of the public list
    expect((await h.app.inject({ method: "GET", url: "/flags" })).json()).toEqual({ flags: {} })

    await as("PUT", "/admin/flags/queue.aim1v1.open", { enabled: true })
    expect(await joinError(a!, ["aim1v1"])).toBeNull()
    expect((await h.app.inject({ method: "GET", url: "/flags" })).json()).toEqual({ flags: { "queue.aim1v1.open": true } })
  })

  it("pulls waiting tickets out of a mode when it closes", async () => {
    const { as } = await setup()
    const [a, b] = await makeUsers(h.db, 2)
    await h.ctx.queue.join(a!, ["aim1v1", "rush3v3"])
    await h.ctx.queue.join(b!, ["aim1v1"])

    const res = await as("PUT", "/admin/flags/queue.aim1v1.open", { enabled: false })
    expect(res.json()).toMatchObject({ drained: 2 })
    expect(await h.ctx.queue.waiting("aim1v1")).toHaveLength(0)
    const rush = await h.ctx.queue.waiting("rush3v3")
    expect(rush.map((t) => t.steamIds)).toEqual([[a]])
  })

  it("deletes flags, hides admin routes and audits every write", async () => {
    const { as } = await setup()
    expect((await h.app.inject({ method: "GET", url: "/admin/flags" })).statusCode).toBe(404)
    expect((await as("PUT", "/admin/flags/Bad Key", { enabled: true })).statusCode).toBe(400)

    await as("PUT", "/admin/flags/beta.cups", { enabled: true, value: { max: 3 } })
    expect((await h.app.inject({ method: "GET", url: "/flags" })).json()).toEqual({ flags: { "beta.cups": { max: 3 } } })
    const list = (await as("GET", "/admin/flags")).json() as { flags: { key: string }[] }
    expect(list.flags.map((f) => f.key)).toEqual(["beta.cups"])

    expect((await as("DELETE", "/admin/flags/beta.cups")).statusCode).toBe(200)
    expect((await as("DELETE", "/admin/flags/beta.cups")).statusCode).toBe(404)

    const rows = await h.db.select().from(adminAudit).where(eq(adminAudit.target, "beta.cups"))
    expect(rows.map((r) => r.action).sort()).toEqual(["flag.delete", "flag.set"])
    expect(rows.every((r) => r.adminSteamId === ADMIN)).toBe(true)
  })
})

describe("announcements", () => {
  it("serves only announcements inside their window", async () => {
    const { as } = await setup()
    const at = (minutes: number) => new Date(h.clock.now() + minutes * 60_000).toISOString()

    const live = await as("POST", "/admin/announcements", { text: "Rush is live", level: "info" })
    expect(live.statusCode).toBe(201)
    await as("POST", "/admin/announcements", { text: "Maintenance tonight", level: "warn", startsAt: at(30), endsAt: at(90), dismissible: false })
    await as("POST", "/admin/announcements", { text: "Old news", startsAt: at(-120), endsAt: at(-60) })

    const texts = async () =>
      ((await h.app.inject({ method: "GET", url: "/announcements" })).json() as { announcements: { text: string }[] }).announcements.map((a) => a.text)

    expect(await texts()).toEqual(["Rush is live"])
    h.clock.advance(45 * 60_000)
    expect(await texts()).toEqual(["Maintenance tonight", "Rush is live"])
    h.clock.advance(60 * 60_000)
    expect(await texts()).toEqual(["Rush is live"])

    const all = (await as("GET", "/admin/announcements")).json() as { announcements: unknown[] }
    expect(all.announcements).toHaveLength(3)
  })

  it("validates, edits, deletes and audits", async () => {
    const { as } = await setup()
    const now = new Date(h.clock.now())
    const bad = await as("POST", "/admin/announcements", { text: "x", startsAt: now.toISOString(), endsAt: now.toISOString() })
    expect(bad.statusCode).toBe(400)
    expect((await as("POST", "/admin/announcements", { text: "   " })).statusCode).toBe(400)

    const { announcement } = (await as("POST", "/admin/announcements", { text: "Hello" })).json() as { announcement: { id: string } }
    const patched = await as("PATCH", `/admin/announcements/${announcement.id}`, { text: "Hello again", level: "warn" })
    expect(patched.json()).toMatchObject({ announcement: { text: "Hello again", level: "warn" } })
    // Ending before the start is refused on edit too
    const early = new Date(h.clock.now() - 60_000).toISOString()
    expect((await as("PATCH", `/admin/announcements/${announcement.id}`, { endsAt: early })).statusCode).toBe(400)

    // An end in the past takes it off the site
    await as("PATCH", `/admin/announcements/${announcement.id}`, { startsAt: new Date(h.clock.now() - 120_000).toISOString(), endsAt: early })
    expect((await h.app.inject({ method: "GET", url: "/announcements" })).json()).toEqual({ announcements: [] })

    expect((await as("DELETE", `/admin/announcements/${announcement.id}`)).statusCode).toBe(200)
    expect((await as("DELETE", `/admin/announcements/${announcement.id}`)).statusCode).toBe(404)

    const rows = await h.db.select().from(adminAudit).where(eq(adminAudit.target, announcement.id))
    expect(rows.map((r) => r.action).sort()).toEqual([
      "announcement.create",
      "announcement.delete",
      "announcement.update",
      "announcement.update",
    ])
  })
})

describe("profile lookup for manual bans", () => {
  it("resolves ids and profile URLs", async () => {
    const { as } = await setup()
    const [a] = await makeUsers(h.db, 1)
    const byUrl = await as("GET", `/admin/users/resolve?q=${encodeURIComponent(`https://steamcommunity.com/profiles/${a}/`)}`)
    expect(byUrl.json()).toMatchObject({ steamId: a, registered: true })
    expect((await as("GET", "/admin/users/resolve?q=76561198000000404")).json()).toMatchObject({ registered: false })
    // Tests run offline without a Steam key, so custom URLs cannot resolve
    expect((await as("GET", "/admin/users/resolve?q=https://steamcommunity.com/id/someone")).statusCode).toBe(404)
    expect((await as("GET", "/admin/users/resolve?q=hello")).statusCode).toBe(400)
  })
})
