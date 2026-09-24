import { AIM_MAPS } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAppHarness } from "../../../test/helpers.js"
import { adminAudit, mapPool, users } from "../../db/schema.js"

const ROOT = "76561198900000001"
const PLAYER = "76561198900000003"

const DETAILS: Record<string, unknown> = {
  "3412345678": {
    publishedfileid: "3412345678",
    result: 1,
    creator: "76561198000000009",
    consumer_app_id: 730,
    title: "Aim Botz (CS2)",
    preview_url: "https://images.steamusercontent.com/ugc/1/ABC/",
    file_size: "1000",
    tags: [{ tag: "Map" }, { tag: "Cs2" }],
  },
  "3070290869": {
    publishedfileid: "3070290869",
    result: 1,
    consumer_app_id: 730,
    title: "awp_india",
    tags: [{ tag: "Map" }],
  },
  "3400000000": {
    publishedfileid: "3400000000",
    result: 1,
    consumer_app_id: 730,
    title: "Some mod",
    tags: [{ tag: "Mod" }],
  },
}

// Answers Steam's details call from the table above. Anything else is offline
const steamFetch = (async (url: string, init?: RequestInit) => {
  if (!String(url).includes("GetPublishedFileDetails")) throw new Error("offline")
  const id = new URLSearchParams(String(init?.body)).get("publishedfileids[0]")!
  const details = DETAILS[id] ?? { publishedfileid: id, result: 9 }
  return new Response(JSON.stringify({ response: { publishedfiledetails: [details] } }))
}) as unknown as typeof fetch

describe("admin map pool routes", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  const cookie: Record<string, string> = {}

  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ROOT }, fetch: steamFetch })
    await h.db.insert(users).values([
      { steamId: ROOT, displayName: "root" },
      { steamId: PLAYER, displayName: "player" },
    ])
    for (const id of [ROOT, PLAYER]) cookie[id] = h.app.signCookie(await h.ctx.sessions.create(id))
  })
  afterAll(async () => {
    await h.close()
  })

  const as = (id: string) => {
    const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: Record<string, unknown>) =>
      h.app.inject({ method, url, ...(payload ? { payload } : {}), cookies: { rs_sid: cookie[id]! } })
    return {
      get: (url: string) => req("GET", url),
      post: (url: string, p: Record<string, unknown>) => req("POST", url, p),
      patch: (url: string, p: Record<string, unknown>) => req("PATCH", url, p),
      put: (url: string, p: Record<string, unknown>) => req("PUT", url, p),
      del: (url: string) => req("DELETE", url),
    }
  }

  it("hides the routes from non admins", async () => {
    expect((await as(PLAYER).get("/admin/maps")).statusCode).toBe(404)
    expect((await as(PLAYER).get("/admin/maps/workshop?q=3412345678")).statusCode).toBe(404)
    expect((await as(PLAYER).post("/admin/maps", { workshop: "3412345678", modes: ["aim1v1"] })).statusCode).toBe(404)
    expect((await as(PLAYER).patch("/admin/maps/aim_map", { modes: [] })).statusCode).toBe(404)
    expect((await as(PLAYER).put("/admin/maps/order", { ids: ["aim_map"] })).statusCode).toBe(404)
    expect((await as(PLAYER).del("/admin/maps/aim_map")).statusCode).toBe(404)
    expect((await h.app.inject({ method: "GET", url: "/admin/maps" })).statusCode).toBe(404)
    expect(await h.db.select().from(mapPool)).toEqual([])
  })

  it("lists the config pool before any edit", async () => {
    const res = await as(ROOT).get("/admin/maps")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.stored).toBe(false)
    expect(body.minPool).toEqual({ aim1v1: 5, aim2v2: 5 })
    expect(body.maps.map((m: { id: string }) => m.id)).toEqual(AIM_MAPS.map((m) => m.id))
  })

  it("previews a Workshop URL", async () => {
    const res = await as(ROOT).get(
      `/admin/maps/workshop?q=${encodeURIComponent("https://steamcommunity.com/sharedfiles/filedetails/?id=3412345678&searchtext=")}`,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      item: { workshopId: "3412345678", title: "Aim Botz (CS2)", previewUrl: "https://images.steamusercontent.com/ugc/1/ABC/", cs2: true },
      suggestedId: "aim_botz_cs2",
      existingId: null,
    })
    expect((await as(ROOT).get("/admin/maps/workshop?q=3070290869")).json().existingId).toBe("awp_india")
  })

  it("validates Workshop input", async () => {
    const bad = await as(ROOT).get(`/admin/maps/workshop?q=${encodeURIComponent("https://example.com/?id=1")}`)
    expect(bad.statusCode).toBe(400)
    expect((await as(ROOT).get("/admin/maps/workshop?q=999")).json().error).toBe("workshop_not_found")
    const mod = await as(ROOT).get("/admin/maps/workshop?q=3400000000")
    expect(mod.statusCode).toBe(422)
    expect(mod.json().error).toBe("not_a_map")
  })

  it("validates the add body", async () => {
    const cases = [
      { workshop: "3412345678", modes: ["rush3v3"] },
      { workshop: "3412345678", id: "Bad Id" },
      { workshop: "3412345678", loadout: { primary: { ct: "weapon_ak47; quit" } } },
      { workshop: "3412345678", loadout: { armor: "heavy" } },
      { modes: ["aim1v1"] },
    ]
    for (const body of cases) {
      const res = await as(ROOT).post("/admin/maps", body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
    }
    expect(await h.db.select().from(mapPool)).toEqual([])
  })

  it("adds a Workshop map and writes an audit row", async () => {
    const res = await as(ROOT).post("/admin/maps", {
      workshop: "https://steamcommunity.com/sharedfiles/filedetails/?id=3412345678",
      displayName: "Botz",
      modes: ["aim1v1", "aim2v2"],
      loadout: { primary: { ct: "weapon_m4a1", t: "weapon_ak47" }, secondary: { ct: "weapon_usp_silencer", t: "weapon_glock" }, armor: "kevlar_helmet" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().map).toMatchObject({
      id: "aim_botz_cs2",
      displayName: "Botz",
      workshopId: "3412345678",
      modes: ["aim1v1", "aim2v2"],
      source: "admin",
      previewUrl: "https://images.steamusercontent.com/ugc/1/ABC/",
    })
    expect(res.json().audit).toMatchObject({ action: "map.add", target: "aim_botz_cs2", adminSteamId: ROOT })
    expect(h.ctx.maps.entries("aim2v2").map((m) => m.id)).toContain("aim_botz_cs2")
    const dup = await as(ROOT).post("/admin/maps", { workshop: "3412345678", id: "another" })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe("map_exists")
  })

  it("refuses to disable below the minimum pool", async () => {
    // Seven maps now. Two can go before aim1v1 hits five
    expect((await as(ROOT).patch("/admin/maps/aim_map", { modes: ["aim2v2"] })).statusCode).toBe(200)
    expect((await as(ROOT).patch("/admin/maps/aim_usp", { modes: [] })).statusCode).toBe(200)
    const res = await as(ROOT).patch("/admin/maps/aim_redline", { modes: ["aim2v2"] })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: "pool_too_small", details: { mode: "aim1v1", min: 5 } })
    expect(h.ctx.maps.entries("aim1v1")).toHaveLength(5)
    const audits = await h.db.select().from(adminAudit).where(eq(adminAudit.action, "map.update"))
    expect(audits).toHaveLength(2)
  })

  it("edits name and loadout, reorders and removes", async () => {
    const empty = await as(ROOT).patch("/admin/maps/aim_map", {})
    expect(empty.statusCode).toBe(400)
    expect((await as(ROOT).patch("/admin/maps/nope_map", { displayName: "x" })).statusCode).toBe(404)
    const named = await as(ROOT).patch("/admin/maps/awp_india", { displayName: "India", loadout: { primary: { ct: "weapon_ssg08", t: "weapon_ssg08" } } })
    expect(named.statusCode).toBe(200)
    expect(h.ctx.maps.find("aim1v1", "awp_india")).toMatchObject({ displayName: "India", loadout: { primary: { ct: "weapon_ssg08" } } })

    const ids = (await as(ROOT).get("/admin/maps")).json().maps.map((m: { id: string }) => m.id) as string[]
    const order = await as(ROOT).put("/admin/maps/order", { ids: [...ids].reverse() })
    expect(order.statusCode).toBe(200)
    expect(order.json().audit).toMatchObject({ action: "map.reorder" })
    expect((await as(ROOT).put("/admin/maps/order", { ids: ids.slice(1) })).statusCode).toBe(400)

    expect((await as(ROOT).del("/admin/maps/aim_botz_cs2")).json().error).toBe("map_enabled")
    // aim1v1 sits at five, so Botz can only go once another map is back
    expect((await as(ROOT).patch("/admin/maps/aim_botz_cs2", { modes: [] })).statusCode).toBe(409)
    expect((await as(ROOT).patch("/admin/maps/aim_usp", { modes: ["aim1v1", "aim2v2"] })).statusCode).toBe(200)
    expect((await as(ROOT).patch("/admin/maps/aim_botz_cs2", { modes: [] })).statusCode).toBe(200)
    const removed = await as(ROOT).del("/admin/maps/aim_botz_cs2")
    expect(removed.statusCode).toBe(200)
    expect(removed.json().audit).toMatchObject({ action: "map.remove", target: "aim_botz_cs2" })
    expect((await as(ROOT).del("/admin/maps/aim_map")).json().error).toBe("config_map")
  })

  it("serves the live pool on the public routes", async () => {
    const maps = (await h.app.inject({ method: "GET", url: "/maps" })).json().maps as { id: string; displayName: string }[]
    expect(maps.find((m) => m.id === "awp_india")?.displayName).toBe("India")
    const modes = (await h.app.inject({ method: "GET", url: "/modes" })).json() as { mode: string; maps: { id: string }[] }[]
    expect(modes.find((m) => m.mode === "aim1v1")!.maps.map((m) => m.id)).not.toContain("aim_map")
  })
})
