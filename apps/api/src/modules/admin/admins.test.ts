import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { adminAudit, admins, users } from "../../db/schema.js"

const ROOT = "76561198900000001"
const GRANTED = "76561198900000002"
const PLAYER = "76561198900000003"
const STRANGER = "76561198900000004"

describe("admin list routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}

  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ROOT } })
    await h.db.insert(users).values([
      { steamId: ROOT, displayName: "root", avatarUrl: "https://avatars.test/root.jpg" },
      { steamId: GRANTED, displayName: "granted" },
      { steamId: PLAYER, displayName: "player" },
    ])
    for (const id of [ROOT, GRANTED, PLAYER]) cookie[id] = h.app.signCookie(await h.ctx.sessions.create(id))
  })
  afterAll(async () => {
    await h.close()
  })

  const as = (id: string) => ({
    get: (url: string) => h.app.inject({ method: "GET", url, cookies: { rs_sid: cookie[id]! } }),
    post: (url: string, payload: Record<string, unknown>) =>
      h.app.inject({ method: "POST", url, payload, cookies: { rs_sid: cookie[id]! } }),
    del: (url: string) => h.app.inject({ method: "DELETE", url, cookies: { rs_sid: cookie[id]! } }),
  })

  it("hides the routes from non admins", async () => {
    expect((await as(PLAYER).get("/admin/admins")).statusCode).toBe(404)
    expect((await as(PLAYER).post("/admin/admins", { steamId: PLAYER })).statusCode).toBe(404)
    expect((await as(PLAYER).del(`/admin/admins/${ROOT}`)).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/admin/admins" })).statusCode).toBe(404)
    expect(await h.db.select().from(admins)).toEqual([])
  })

  it("lists config admins as root", async () => {
    const res = await as(ROOT).get("/admin/admins")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      admins: [{ steamId: ROOT, source: "config", displayName: "root", avatarUrl: "https://avatars.test/root.jpg" }],
    })
  })

  it("validates the SteamID64", async () => {
    for (const steamId of ["123", "not-an-id", "12345678901234567"]) {
      const res = await as(ROOT).post("/admin/admins", { steamId })
      expect(res.statusCode, steamId).toBe(400)
      expect(res.json().error).toBe("invalid_request")
    }
  })

  it("grants, then the granted user can call admin routes", async () => {
    expect((await as(GRANTED).get("/admin/overview")).statusCode).toBe(404)
    expect(h.ctx.isAdmin(GRANTED)).toBe(false)

    const res = await as(ROOT).post("/admin/admins", { steamId: GRANTED, note: "moderator" })
    expect(res.statusCode).toBe(201)
    expect(res.json().admin).toMatchObject({ steamId: GRANTED, source: "db", addedBy: ROOT, note: "moderator", displayName: "granted" })
    expect(res.json().audit).toMatchObject({ action: "admin.grant", target: GRANTED, adminSteamId: ROOT })

    expect(h.ctx.isAdmin(GRANTED)).toBe(true)
    expect((await as(GRANTED).get("/admin/overview")).statusCode).toBe(200)
    const me = (await as(GRANTED).get("/me")).json() as { user: { isAdmin?: boolean } }
    expect(me.user.isAdmin).toBe(true)
  })

  it("returns 409 for an existing admin", async () => {
    const dup = await as(ROOT).post("/admin/admins", { steamId: GRANTED })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe("already_admin")
    const root = await as(GRANTED).post("/admin/admins", { steamId: ROOT })
    expect(root.statusCode).toBe(409)
  })

  it("lists config and db admins", async () => {
    const list = (await as(GRANTED).get("/admin/admins")).json() as { admins: Record<string, unknown>[] }
    expect(list.admins).toHaveLength(2)
    expect(list.admins[0]).toMatchObject({ steamId: ROOT, source: "config" })
    expect(list.admins[0]).not.toHaveProperty("addedBy")
    expect(list.admins[1]).toMatchObject({
      steamId: GRANTED,
      source: "db",
      addedBy: ROOT,
      note: "moderator",
      displayName: "granted",
      createdAt: expect.any(String),
    })
  })

  it("keeps players who never signed in without a name", async () => {
    const res = await as(ROOT).post("/admin/admins", { steamId: STRANGER })
    expect(res.statusCode).toBe(201)
    expect(res.json().admin).not.toHaveProperty("displayName")
    expect(res.json().admin).not.toHaveProperty("note")
  })

  it("refuses to remove a config admin", async () => {
    const res = await as(GRANTED).del(`/admin/admins/${ROOT}`)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe("config_admin")
    expect(h.ctx.isAdmin(ROOT)).toBe(true)
  })

  it("refuses to remove yourself", async () => {
    const res = await as(GRANTED).del(`/admin/admins/${GRANTED}`)
    expect(res.statusCode).toBe(400)
    expect(h.ctx.isAdmin(GRANTED)).toBe(true)
  })

  it("returns 404 for someone who is not an admin", async () => {
    expect((await as(ROOT).del(`/admin/admins/${PLAYER}`)).statusCode).toBe(404)
    expect((await as(ROOT).del("/admin/admins/nope")).statusCode).toBe(404)
  })

  it("revokes and the revoked user loses access", async () => {
    const res = await as(ROOT).del(`/admin/admins/${GRANTED}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().audit).toMatchObject({ action: "admin.revoke", target: GRANTED, adminSteamId: ROOT })
    expect(h.ctx.isAdmin(GRANTED)).toBe(false)
    expect((await as(GRANTED).get("/admin/overview")).statusCode).toBe(404)
    expect(await h.db.select().from(admins).where(eq(admins.steamId, GRANTED))).toEqual([])

    const actions = (await h.db.select().from(adminAudit)).map((r) => [r.action, r.target])
    expect(actions).toEqual(
      expect.arrayContaining([
        ["admin.grant", GRANTED],
        ["admin.grant", STRANGER],
        ["admin.revoke", GRANTED],
      ]),
    )
  })

  it("picks up rows written by another instance after a reload", async () => {
    await h.db.insert(admins).values({ steamId: PLAYER, addedBy: ROOT })
    expect(h.ctx.isAdmin(PLAYER)).toBe(false)
    await h.ctx.admins.refresh()
    expect(h.ctx.isAdmin(PLAYER)).toBe(true)
  })
})
