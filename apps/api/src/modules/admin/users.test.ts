import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { adminAudit, cooldowns, users } from "../../db/schema.js"

const ADMIN = "76561198999999997"
let h: Awaited<ReturnType<typeof createAppHarness>>

afterEach(async () => {
  await h?.close()
})

async function setup(env: Record<string, string> = {}) {
  h = await createAppHarness({ plugins: { tournaments: false, admin: true }, env: { ADMIN_STEAM_IDS: ADMIN, ...env } })
  await h.db.insert(users).values({ steamId: ADMIN, displayName: "boss" })
  const cookie = h.app.signCookie(await h.ctx.sessions.create(ADMIN))
  const as = (method: "GET" | "POST", url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: { rs_sid: cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) })
  return { as }
}

describe("admin user tools on the real app", () => {
  it("searches by name and limits the search per admin", async () => {
    const { as } = await setup({ RATE_LIMIT_ENABLED: "true" })
    const [a, b] = await makeUsers(h.db, 2)
    await h.db.update(users).set({ displayName: "Vexa" }).where(eq(users.steamId, a!))
    await h.db.update(users).set({ displayName: "lovexa" }).where(eq(users.steamId, b!))

    const res = await as("GET", "/admin/users?q=vexa")
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-ratelimit-limit"]).toBe("30")
    expect(res.json().users.map((u: { steamId: string }) => u.steamId)).toEqual([a, b])

    // Non admins still get the stock 404
    expect((await h.app.inject({ method: "GET", url: "/admin/users?q=vexa" })).statusCode).toBe(404)
  })

  it("clears a cooldown so the player can queue again", async () => {
    const { as } = await setup()
    const [p] = await makeUsers(h.db, 1)
    await h.ctx.cooldowns.issue(p!, "decline", null)
    await expect(h.ctx.queue.join(p!, ["aim1v1"])).rejects.toMatchObject({ code: "cooldown" })

    const before = (await as("GET", `/admin/users/${p}`)).json()
    expect(before.cooldowns).toHaveLength(1)
    expect(before.state).toEqual({ queue: null, match: null })

    h.notifier.clear()
    const res = await as("POST", `/admin/users/${p}/cooldown/clear`, {})
    expect(res.statusCode).toBe(200)
    const [row] = await h.db.select().from(adminAudit).where(eq(adminAudit.target, p!))
    expect(row).toMatchObject({ adminSteamId: ADMIN, action: "user.cooldown_clear" })
    expect(h.notifier.ofType("queue_status").map((s) => s.msg)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ state: "idle" }) })])
    expect(await h.db.select().from(cooldowns).where(eq(cooldowns.steamId, p!))).toHaveLength(1)

    await h.ctx.queue.join(p!, ["aim1v1"])
    const after = (await as("GET", `/admin/users/${p}`)).json()
    expect(after.state.queue).toMatchObject({ modes: ["aim1v1"] })
    expect(after.audit[0]).toMatchObject({ action: "user.cooldown_clear", adminName: "boss" })
    expect((await as("POST", `/admin/users/${p}/cooldown/clear`, {})).statusCode).toBe(409)
  })
})
