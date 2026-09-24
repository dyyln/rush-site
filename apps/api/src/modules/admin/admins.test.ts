import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { adminAudit, admins, users } from "../../db/schema.js"
import { LocalHub } from "../ws/hub.js"
import { canManageAdmins } from "./admins-routes.js"

const ROOT = "76561198900000001"
const GRANTED = "76561198900000002"
const PLAYER = "76561198900000003"
const STRANGER = "76561198900000004"
const ROOT2 = "76561198900000005"

// Answers GetPlayerSummaries for STRANGER only
const steamFetch = (async (input: string | URL) => {
  const url = String(input)
  if (!url.includes("GetPlayerSummaries")) throw new Error(`unexpected fetch ${url}`)
  const ids = new URL(url).searchParams.get("steamids")!.split(",")
  const players = ids
    .filter((id) => id === STRANGER)
    .map((id) => ({ steamid: id, personaname: "stranger", avatarfull: "https://avatars.test/s.jpg", profileurl: "https://steamcommunity.com/id/stranger/" }))
  return new Response(JSON.stringify({ response: { players } }), { status: 200 })
}) as unknown as typeof fetch

describe("admin list routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}

  beforeAll(async () => {
    h = await createAppHarness({
      plugins: { tournaments: false, admin: true },
      env: { ADMIN_STEAM_IDS: `${ROOT},${ROOT2}`, STEAM_API_KEY: "test-key" },
      fetch: steamFetch,
    })
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
  beforeEach(() => h.notifier.clear())

  const as = (id: string) => ({
    get: (url: string) => h.app.inject({ method: "GET", url, cookies: { rs_sid: cookie[id]! } }),
    post: (url: string, payload: Record<string, unknown>) =>
      h.app.inject({ method: "POST", url, payload, cookies: { rs_sid: cookie[id]! } }),
    del: (url: string) => h.app.inject({ method: "DELETE", url, cookies: { rs_sid: cookie[id]! } }),
  })

  it("only lets super admins manage admins", () => {
    const dir = { rootIds: () => [ROOT] }
    expect(canManageAdmins(dir, ROOT)).toBe(true)
    expect(canManageAdmins(dir, GRANTED)).toBe(false)
  })

  it("hides the routes from non admins", async () => {
    expect((await as(PLAYER).get("/admin/admins")).statusCode).toBe(404)
    expect((await as(PLAYER).get(`/admin/admins/lookup?q=${PLAYER}`)).statusCode).toBe(404)
    expect((await as(PLAYER).post("/admin/admins", { steamId: PLAYER })).statusCode).toBe(404)
    expect((await as(PLAYER).del(`/admin/admins/${ROOT}`)).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/admin/admins" })).statusCode).toBe(404)
    expect(await h.db.select().from(admins)).toEqual([])
  })

  it("lists super admins with Steam names for ids that never signed in", async () => {
    const res = await as(ROOT).get("/admin/admins")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      admins: [
        { steamId: ROOT, source: "config", super: true, signedIn: true, displayName: "root", avatarUrl: "https://avatars.test/root.jpg" },
        { steamId: ROOT2, source: "config", super: true, signedIn: false },
      ],
      viewer: { steamId: ROOT, super: true, canManage: true },
    })
  })

  it("previews a candidate from a user row, Steam or neither", async () => {
    const known = (await as(ROOT).get(`/admin/admins/lookup?q=https://steamcommunity.com/profiles/${PLAYER}/`)).json()
    expect(known).toMatchObject({ steamId: PLAYER, displayName: "player", signedIn: true, admin: null })

    const steam = (await as(ROOT).get(`/admin/admins/lookup?q=${STRANGER}`)).json()
    expect(steam).toMatchObject({ steamId: STRANGER, displayName: "stranger", avatarUrl: "https://avatars.test/s.jpg", signedIn: false })

    expect((await as(ROOT).get(`/admin/admins/lookup?q=${ROOT2}`)).json()).toMatchObject({ admin: "super", signedIn: false })
    expect((await as(ROOT).get("/admin/admins/lookup?q=hello")).statusCode).toBe(400)
    expect((await as(ROOT).get("/admin/admins/lookup?q=12345678901234567")).statusCode).toBe(400)
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
    expect(res.json().admin).toMatchObject({
      steamId: GRANTED,
      super: false,
      source: "db",
      addedBy: ROOT,
      addedByName: "root",
      note: "moderator",
      displayName: "granted",
    })
    expect(res.json().audit).toMatchObject({ action: "admin.grant", target: GRANTED, adminSteamId: ROOT })
    expect(h.notifier.sent.map((s) => s.audience)).toContainEqual({ kind: "admin_access", steamIds: [GRANTED], isAdmin: true })
    expect(h.notifier.ofType("admin_event").map((s) => s.msg.payload)).toContainEqual({
      kind: "user",
      payload: { action: "admin_granted", steamId: GRANTED, by: ROOT },
    })

    expect(h.ctx.isAdmin(GRANTED)).toBe(true)
    expect((await as(GRANTED).get("/admin/overview")).statusCode).toBe(200)
    const me = (await as(GRANTED).get("/me")).json() as { user: { isAdmin?: boolean } }
    expect(me.user.isAdmin).toBe(true)
  })

  it("returns 409 for an existing admin", async () => {
    const dup = await as(ROOT).post("/admin/admins", { steamId: GRANTED })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe("already_admin")
    expect((await as(ROOT).post("/admin/admins", { steamId: ROOT2 })).statusCode).toBe(409)
  })

  it("lets regular admins view the list but not change it", async () => {
    const list = (await as(GRANTED).get("/admin/admins")).json() as { admins: Record<string, unknown>[]; viewer: unknown }
    expect(list.viewer).toEqual({ steamId: GRANTED, super: false, canManage: false })
    expect(list.admins).toHaveLength(3)
    expect(list.admins[0]).toMatchObject({ steamId: ROOT, super: true })
    expect(list.admins[0]).not.toHaveProperty("addedBy")
    expect(list.admins[2]).toMatchObject({ steamId: GRANTED, super: false, addedBy: ROOT, createdAt: expect.any(String) })

    const auditBefore = (await h.db.select().from(adminAudit)).length
    const add = await as(GRANTED).post("/admin/admins", { steamId: PLAYER })
    expect(add.statusCode).toBe(403)
    expect(add.json().error).toBe("super_admin_only")
    await h.db.insert(admins).values({ steamId: STRANGER, addedBy: ROOT })
    const del = await as(GRANTED).del(`/admin/admins/${STRANGER}`)
    expect(del.statusCode).toBe(403)
    expect(del.json().error).toBe("super_admin_only")
    expect((await as(GRANTED).del(`/admin/admins/${ROOT}`)).statusCode).toBe(403)
    expect(await h.db.select().from(admins).where(eq(admins.steamId, STRANGER))).toHaveLength(1)
    expect(await h.db.select().from(adminAudit)).toHaveLength(auditBefore)
    await h.db.delete(admins).where(eq(admins.steamId, STRANGER))
  })

  it("keeps players Steam does not know without a name", async () => {
    const res = await as(ROOT).post("/admin/admins", { steamId: PLAYER.replace(/3$/, "9") })
    expect(res.statusCode).toBe(201)
    expect(res.json().admin).toMatchObject({ signedIn: false })
    expect(res.json().admin).not.toHaveProperty("displayName")
    expect(res.json().admin).not.toHaveProperty("note")
  })

  it("never removes a super admin", async () => {
    const res = await as(ROOT).del(`/admin/admins/${ROOT2}`)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe("super_admin")
    expect(h.ctx.isAdmin(ROOT2)).toBe(true)
  })

  it("refuses to remove yourself", async () => {
    const res = await as(ROOT).del(`/admin/admins/${ROOT}`)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("cannot_remove_self")
    expect(h.ctx.isAdmin(ROOT)).toBe(true)
  })

  it("returns 404 for someone who is not an admin", async () => {
    expect((await as(ROOT).del(`/admin/admins/${PLAYER}`)).statusCode).toBe(404)
    expect((await as(ROOT).del("/admin/admins/nope")).statusCode).toBe(404)
  })

  it("revokes and the revoked user loses access", async () => {
    const res = await as(ROOT).del(`/admin/admins/${GRANTED}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().audit).toMatchObject({ action: "admin.revoke", target: GRANTED, adminSteamId: ROOT })
    expect(h.notifier.sent.map((s) => s.audience)).toContainEqual({ kind: "admin_access", steamIds: [GRANTED], isAdmin: false })
    expect(h.ctx.isAdmin(GRANTED)).toBe(false)
    expect((await as(GRANTED).get("/admin/overview")).statusCode).toBe(404)
    expect(await h.db.select().from(admins).where(eq(admins.steamId, GRANTED))).toEqual([])

    const actions = (await h.db.select().from(adminAudit)).map((r) => [r.action, r.target, r.adminSteamId])
    expect(actions).toEqual(
      expect.arrayContaining([
        ["admin.grant", GRANTED, ROOT],
        ["admin.revoke", GRANTED, ROOT],
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

describe("admin audience on the hub", () => {
  it("moves open sockets in and out of admin events", () => {
    const hub = new LocalHub()
    const got: string[] = []
    const socket = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d: string) => got.push(JSON.parse(d).type) }
    hub.add(GRANTED, socket, false)
    const event = { type: "admin_event", payload: { kind: "user", payload: {} }, ts: 1 }
    hub.deliver({ kind: "admins" }, event)
    expect(got).toEqual([])

    hub.deliver({ kind: "admin_access", steamIds: [GRANTED], isAdmin: true }, { type: "admin_access", payload: {}, ts: 1 })
    hub.deliver({ kind: "admins" }, event)
    expect(got).toEqual(["admin_event"])

    hub.deliver({ kind: "admin_access", steamIds: [GRANTED], isAdmin: false }, { type: "admin_access", payload: {}, ts: 1 })
    hub.deliver({ kind: "admins" }, event)
    expect(got).toEqual(["admin_event"])
  })
})
