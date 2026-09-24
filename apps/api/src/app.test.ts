import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { users } from "./db/schema.js"
import type { Db } from "./db/client.js"
import { createAppHarness } from "../test/helpers.js"

const ADMIN = "76561198999999999"
const makeUsersWithIds = (db: Db, ids: string[]) => db.insert(users).values(ids.map((steamId) => ({ steamId, displayName: "admin" })))

describe("app wiring", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>
  beforeAll(async () => {
    h = await createAppHarness({ plugins: { tournaments: true, admin: true }, env: { ADMIN_STEAM_IDS: ADMIN } })
  })
  afterAll(async () => {
    await h.close()
  })

  it("serves health and public reads", async () => {
    expect((await h.app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({ ok: true, ws: { droppedSlow: expect.any(Number), closedSlow: expect.any(Number) } })
    const modes = (await h.app.inject({ method: "GET", url: "/modes" })).json() as { mode: string }[]
    expect(modes.map((m) => m.mode)).toEqual(["aim1v1", "aim2v2", "rush3v3", "rush1v1"])
    const lb = await h.app.inject({ method: "GET", url: "/leaderboard/aim1v1" })
    expect(lb.statusCode).toBe(200)
    expect(lb.json()).toEqual({ mode: "aim1v1", total: 0, rows: [] })
    const stats = (await h.app.inject({ method: "GET", url: "/stats/modes" })).json()
    expect(stats).toEqual({
      modes: [
        { mode: "aim1v1", playersInQueue: 0, matchesInProgress: 0 },
        { mode: "aim2v2", playersInQueue: 0, matchesInProgress: 0 },
        { mode: "rush3v3", playersInQueue: 0, matchesInProgress: 0 },
        { mode: "rush1v1", playersInQueue: 0, matchesInProgress: 0 },
      ],
    })
    const missing = await h.app.inject({ method: "GET", url: "/nope" })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: "not_found" })
  })

  it("loads the tournaments and admin plugins", async () => {
    expect((await h.app.inject({ method: "GET", url: "/tournaments" })).statusCode).toBe(200)
    // Admin routes hide behind a 404 for everyone else
    expect((await h.app.inject({ method: "GET", url: "/admin/overview" })).statusCode).toBe(404)
    await makeUsersWithIds(h.db, [ADMIN])
    const sid = h.app.signCookie(await h.ctx.sessions.create(ADMIN))
    const res = await h.app.inject({ method: "GET", url: "/admin/overview", cookies: { rs_sid: sid } })
    expect(res.statusCode).toBe(200)
  })
})
