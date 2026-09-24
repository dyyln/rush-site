import { AIM_MAPS, minPoolSize, type VetoState, type WorkshopItem } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { mapPool, vetoes } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { MapPoolService } from "./pool.js"

const ADMIN = "76561198900000001"

function workshopItem(id: string, title: string): WorkshopItem {
  return {
    workshopId: id,
    title,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    previewUrl: `https://images.steamusercontent.com/ugc/${id}/preview/`,
    creatorSteamId: "76561198000000001",
    creatorName: "maker",
    fileSize: 1000,
    tags: ["Map", "Cs2"],
    createdAt: null,
    updatedAt: null,
    subscriptions: 10,
    cs2: true,
  }
}

describe("map pool", () => {
  let h: Harness
  let pool: MapPoolService
  let now: number
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    now = 1_000_000
    pool = new MapPoolService(h.db, undefined, () => now)
    await pool.refresh()
  })
  afterEach(async () => {
    await h.close()
  })

  it("falls back to the shared config while the table is empty", async () => {
    expect(pool.stored()).toBe(false)
    expect(pool.entries("aim1v1").map((m) => m.id)).toEqual(AIM_MAPS.map((m) => m.id))
    expect(pool.entries("rush3v3").map((m) => m.id)).toEqual(["rush_001"])
    expect(pool.find("aim2v2", "awp_india")).toMatchObject({ workshopId: "3070290869" })
    const view = await pool.view()
    expect(view.stored).toBe(false)
    expect(view.minPool).toEqual({ aim1v1: 5, aim2v2: 5 })
    expect(await h.db.select().from(mapPool)).toEqual([])
  })

  it("seeds the config maps on the first write and adds after them", async () => {
    const added = await pool.add(
      {
        id: "aim_botz",
        displayName: "Botz",
        modes: ["aim1v1"],
        loadout: { primary: { ct: "weapon_ak47", t: "weapon_ak47" }, armor: "kevlar" },
        workshop: workshopItem("123456", "aim_botz"),
      },
      ADMIN,
    )
    expect(added).toMatchObject({ id: "aim_botz", source: "admin", position: AIM_MAPS.length, previewUrl: "https://images.steamusercontent.com/ugc/123456/preview/" })
    const rows = await h.db.select().from(mapPool)
    expect(rows).toHaveLength(AIM_MAPS.length + 1)
    expect(rows.filter((r) => r.source === "config")).toHaveLength(AIM_MAPS.length)
    expect(pool.stored()).toBe(true)
    expect(pool.entries("aim1v1").map((m) => m.id)).toEqual([...AIM_MAPS.map((m) => m.id), "aim_botz"])
    expect(pool.entries("aim2v2").map((m) => m.id)).not.toContain("aim_botz")
    // match.json gets the plain MapEntry with the loadout
    expect(pool.find("aim1v1", "aim_botz")).toEqual({
      id: "aim_botz",
      displayName: "Botz",
      workshopId: "123456",
      loadout: { primary: { ct: "weapon_ak47", t: "weapon_ak47" }, armor: "kevlar" },
    })
  })

  it("refuses duplicate ids and Workshop items", async () => {
    await expect(
      pool.add({ id: "aim_map", displayName: "x", modes: [], workshop: workshopItem("1", "x") }, ADMIN),
    ).rejects.toMatchObject({ code: "map_exists" })
    await expect(
      pool.add({ id: "other", displayName: "x", modes: [], workshop: workshopItem("3070290869", "x") }, ADMIN),
    ).rejects.toMatchObject({ code: "map_exists" })
  })

  it("keeps a mode at its minimum pool size", async () => {
    const min = minPoolSize("aim1v1")
    const ids = AIM_MAPS.map((m) => m.id)
    // Six maps, the minimum is five, so one can go
    await pool.update(ids[0]!, { modes: ["aim2v2"] }, ADMIN)
    expect(pool.entries("aim1v1")).toHaveLength(ids.length - 1)
    await expect(pool.update(ids[1]!, { modes: ["aim2v2"] }, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      code: "pool_too_small",
      details: { mode: "aim1v1", min, enabled: min - 1 },
    })
    expect(pool.entries("aim1v1")).toHaveLength(ids.length - 1)
    // Other fields still change
    const { after } = await pool.update(ids[1]!, { displayName: "Red" }, ADMIN)
    expect(after.displayName).toBe("Red")
  })

  it("keeps disabled maps findable so running matches still start", async () => {
    await pool.update("aim_usp", { modes: ["aim2v2"] }, ADMIN)
    expect(pool.entries("aim1v1").map((m) => m.id)).not.toContain("aim_usp")
    expect(pool.find("aim1v1", "aim_usp")?.id).toBe("aim_usp")
  })

  it("reorders and clears a loadout", async () => {
    const ids = AIM_MAPS.map((m) => m.id).reverse()
    await pool.reorder(ids, ADMIN)
    expect(pool.entries("aim2v2").map((m) => m.id)).toEqual(ids)
    await expect(pool.reorder(ids.slice(1), ADMIN)).rejects.toMatchObject({ code: "invalid_request" })
    await expect(pool.reorder([...ids.slice(1), ids[1]!], ADMIN)).rejects.toMatchObject({ code: "invalid_request" })
    await pool.update("aim_map", { loadout: { armor: "none" } }, ADMIN)
    expect(pool.find("aim1v1", "aim_map")?.loadout).toEqual({ armor: "none" })
    await pool.update("aim_map", { loadout: null }, ADMIN)
    expect(pool.find("aim1v1", "aim_map")?.loadout).toBeUndefined()
  })

  it("removes only disabled admin maps", async () => {
    await pool.add({ id: "aim_x", displayName: "X", modes: ["aim1v1"], workshop: workshopItem("42", "X") }, ADMIN)
    await expect(pool.remove("aim_x", ADMIN)).rejects.toMatchObject({ code: "map_enabled" })
    await expect(pool.remove("aim_map", ADMIN)).rejects.toMatchObject({ code: "config_map" })
    await pool.update("aim_x", { modes: [] }, ADMIN)
    expect((await pool.remove("aim_x", ADMIN)).id).toBe("aim_x")
    expect(pool.find("aim1v1", "aim_x")).toBeUndefined()
  })

  it("other instances pick up writes after the cache TTL", async () => {
    const other = new MapPoolService(h.db, undefined, () => now)
    await other.refresh()
    await pool.update("aim_redline", { modes: [] }, ADMIN)
    expect(other.entries("aim1v1").map((m) => m.id)).toContain("aim_redline")
    now += 31_000
    await other.ensureFresh()
    expect(other.entries("aim1v1").map((m) => m.id)).not.toContain("aim_redline")
  })

  it("lists every map the site may need to name", async () => {
    await pool.add({ id: "aim_x", displayName: "X", modes: [], workshop: workshopItem("42", "X") }, ADMIN)
    const maps = await pool.publicMaps()
    expect(maps.find((m) => m.id === "aim_x")).toEqual({
      id: "aim_x",
      displayName: "X",
      modes: [],
      previewUrl: "https://images.steamusercontent.com/ugc/42/preview/",
      workshopId: "42",
    })
    expect(maps.find((m) => m.id === "rush_001")?.modes).toEqual(["rush3v3", "rush1v1"])
  })
})

describe("match flow with the live pool", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
  })
  afterEach(async () => {
    await h.close()
  })

  it("vetoes the live pool and sends the map loadout to the server", async () => {
    const loadout = { secondary: { ct: "weapon_deagle", t: "weapon_deagle" }, armor: "kevlar_helmet" as const }
    await h.ctx.maps.add({ id: "aim_new", displayName: "New", modes: ["aim1v1"], loadout, workshop: workshopItem("777", "New") }, ADMIN)
    await h.ctx.maps.update("aim_map", { modes: ["aim2v2"] }, ADMIN)

    const ids = await makeUsers(h.db, 2)
    for (const id of ids) await h.ctx.queue.join(id, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    for (const id of ids) await h.ctx.flow.respond(id, matchId!, true)

    const load = async () => ((await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId!)))[0]!.state as VetoState)
    let state = await load()
    expect(state.pool).toContain("aim_new")
    expect(state.pool).not.toContain("aim_map")
    while (!state.done) {
      const voter = state.teams[state.steps[state.stepIndex]!.team].steamIds[0]!
      await h.ctx.flow.vote(voter, matchId!, state.available.find((m) => m !== "aim_new")!)
      state = await load()
    }
    expect(state.maps).toEqual(["aim_new"])
    const req = h.agent.started[0]!
    expect(req.map).toEqual({ id: "aim_new", displayName: "New", workshopId: "777", loadout })
    expect(req.cs2.workshopId).toBe("777")
  })
})
