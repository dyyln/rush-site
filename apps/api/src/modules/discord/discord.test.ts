import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAppHarness, createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { activityEvents } from "../activity/schema.js"
import { DiscordError, snowflakeTime, type DiscordApi, type DiscordUser } from "./client.js"
import { discordLinks } from "./schema.js"

const ADMIN = "76561198000009999"

// Discord ids carry their creation time. This one is from 2020
const DISCORD_A = "700000000000000001"
const DISCORD_B = "700000000000000002"

class FakeDiscord implements DiscordApi {
  // code to user
  codes = new Map<string, DiscordUser>()
  members = new Set<string>()
  roles = new Set<string>()
  revoked: string[] = []
  down = false

  user(code: string, id: string, username = `u${id.slice(-3)}`): void {
    this.codes.set(code, { id, username, global_name: null, avatar: null })
  }

  async exchangeCode(code: string): Promise<string> {
    if (!this.codes.has(code)) throw new DiscordError(400, null, "invalid_grant")
    return `token:${code}`
  }

  async me(token: string): Promise<DiscordUser> {
    return this.codes.get(token.slice("token:".length))!
  }

  async revoke(token: string): Promise<void> {
    this.revoked.push(token)
  }

  async addMember(userId: string): Promise<boolean> {
    if (this.down) throw new DiscordError(503, null, "unavailable")
    if (this.members.has(userId)) return false
    this.members.add(userId)
    this.roles.add(userId)
    return true
  }

  async addRole(userId: string): Promise<void> {
    if (this.down) throw new DiscordError(503, null, "unavailable")
    if (!this.members.has(userId)) throw new DiscordError(404, 10007, "Unknown Member")
    this.roles.add(userId)
  }

  async removeRole(userId: string): Promise<void> {
    if (!this.members.has(userId)) throw new DiscordError(404, 10007, "Unknown Member")
    this.roles.delete(userId)
  }
}

describe("discord linking", () => {
  let h: Harness
  let discord: FakeDiscord
  const setup = async () => {
    discord = new FakeDiscord()
    h = await createHarness({ discordApi: discord })
  }
  afterEach(async () => {
    await h.ctx.activity.flush()
    await h.close()
  })

  it("adds a player who is not in the server with the role", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    const { link, joined } = await h.ctx.discord.link(a!, "c1")
    expect(joined).toBe(true)
    expect(link).toMatchObject({ discordId: DISCORD_A, roleGranted: true, syncError: null })
    expect(link.discordCreatedAt).toBe(snowflakeTime(DISCORD_A).toISOString())
    expect(discord.roles.has(DISCORD_A)).toBe(true)
    await vi.waitFor(() => expect(discord.revoked).toEqual(["token:c1"]))
    await h.ctx.activity.flush()
    const events = await h.db.select().from(activityEvents).where(eq(activityEvents.steamId, a!))
    expect(events.map((e) => e.kind)).toEqual(["discord_link"])
  })

  it("gives the role to a player already in the server", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.members.add(DISCORD_A)
    discord.user("c1", DISCORD_A)
    const { joined, link } = await h.ctx.discord.link(a!, "c1")
    expect(joined).toBe(false)
    expect(link.roleGranted).toBe(true)
    expect(discord.roles.has(DISCORD_A)).toBe(true)
  })

  it("refuses a Discord account linked to someone else", async () => {
    await setup()
    const [a, b] = await makeUsers(h.db, 2)
    discord.user("c1", DISCORD_A)
    discord.user("c2", DISCORD_A)
    await h.ctx.discord.link(a!, "c1")
    await expect(h.ctx.discord.link(b!, "c2")).rejects.toMatchObject({ code: "discord_taken" })
    expect(await h.ctx.discord.linkOf(b!)).toBeNull()
  })

  it("moves the role when a player links a different account", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    discord.user("c2", DISCORD_B)
    await h.ctx.discord.link(a!, "c1")
    await h.ctx.discord.link(a!, "c2")
    expect([...discord.roles]).toEqual([DISCORD_B])
    expect(await h.db.select().from(discordLinks)).toHaveLength(1)
  })

  it("keeps the link when Discord fails and records why", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    discord.down = true
    const { link } = await h.ctx.discord.link(a!, "c1")
    expect(link).toMatchObject({ roleGranted: false, syncError: expect.stringContaining("503") })
    discord.down = false
    discord.members.add(DISCORD_A)
    expect(await h.ctx.discord.sync(a!)).toMatchObject({ roleGranted: true, syncError: null })
  })

  it("takes the role on a ban and gives it back on unban", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    await h.ctx.discord.link(a!, "c1")
    await h.ctx.bans.ban(a!, "cheating", { until: new Date(h.clock.now() + 86_400_000) })
    await vi.waitFor(() => expect(discord.roles.has(DISCORD_A)).toBe(false))
    expect(discord.members.has(DISCORD_A)).toBe(true)
    await h.ctx.bans.unban(a!)
    await vi.waitFor(() => expect(discord.roles.has(DISCORD_A)).toBe(true))
  })

  it("notes a player who left the server", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    await h.ctx.discord.link(a!, "c1")
    discord.members.delete(DISCORD_A)
    discord.roles.delete(DISCORD_A)
    expect(await h.ctx.discord.sync(a!)).toMatchObject({ roleGranted: false, syncError: "not_in_server" })
  })

  it("unlinks and removes the role", async () => {
    await setup()
    const [a] = await makeUsers(h.db, 1)
    discord.user("c1", DISCORD_A)
    await h.ctx.discord.link(a!, "c1")
    expect(await h.ctx.discord.unlink(a!)).toBe(true)
    expect(discord.roles.size).toBe(0)
    expect(await h.ctx.discord.linkOf(a!)).toBeNull()
    expect(await h.ctx.discord.unlink(a!)).toBe(false)
  })
})

describe("discord routes", () => {
  const DISCORD_ENV = { DISCORD_CLIENT_ID: "123", ADMIN_STEAM_IDS: ADMIN }

  it("runs the OAuth flow for the signed in player", async () => {
    const discord = new FakeDiscord()
    const h = await createAppHarness({ discordApi: discord, env: DISCORD_ENV })
    try {
      const [a] = await makeUsers(h.db, 1)
      const cookies = { rs_sid: h.app.signCookie(await h.ctx.sessions.create(a!)) }

      const start = await h.app.inject({ method: "GET", url: "/auth/discord", cookies })
      expect(start.statusCode).toBe(302)
      const to = new URL(start.headers.location as string)
      expect(to.origin + to.pathname).toBe("https://discord.com/oauth2/authorize")
      expect(to.searchParams.get("scope")).toBe("identify guilds.join")
      expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3001/auth/discord/callback")
      const state = to.searchParams.get("state")!

      discord.user("c1", DISCORD_A)
      // Another browser cannot finish the flow
      const other = await h.app.inject({ method: "GET", url: `/auth/discord/callback?code=c1&state=${state}` })
      expect(other.headers.location).toBe("http://localhost:3000/settings?discord=expired#discord")

      const again = await h.app.inject({ method: "GET", url: "/auth/discord", cookies })
      const state2 = new URL(again.headers.location as string).searchParams.get("state")!
      const done = await h.app.inject({ method: "GET", url: `/auth/discord/callback?code=c1&state=${state2}`, cookies })
      expect(done.headers.location).toBe("http://localhost:3000/settings?discord=joined#discord")
      // A state works once
      const replay = await h.app.inject({ method: "GET", url: `/auth/discord/callback?code=c1&state=${state2}`, cookies })
      expect(replay.headers.location).toContain("discord=expired")

      const me = await h.app.inject({ method: "GET", url: "/discord/me", cookies })
      expect(me.json()).toMatchObject({ enabled: true, link: { discordId: DISCORD_A, roleGranted: true } })

      const cancelled = await h.app.inject({ method: "GET", url: "/auth/discord/callback?error=access_denied&state=x", cookies })
      expect(cancelled.headers.location).toContain("discord=cancelled")

      const unlink = await h.app.inject({
        method: "POST",
        url: "/discord/unlink",
        cookies,
        headers: { origin: "http://localhost:3000" },
      })
      expect(unlink.json()).toMatchObject({ link: null })
    } finally {
      await h.close()
    }
  })

  it("sends signed out players back to settings", async () => {
    const h = await createAppHarness({ discordApi: new FakeDiscord(), env: DISCORD_ENV })
    try {
      const res = await h.app.inject({ method: "GET", url: "/auth/discord" })
      expect(res.headers.location).toContain("discord=signed_out")
      expect((await h.app.inject({ method: "GET", url: "/discord/me" })).statusCode).toBe(401)
    } finally {
      await h.close()
    }
  })

  it("lets admins see, resync and unlink a player's Discord", async () => {
    const discord = new FakeDiscord()
    const h = await createAppHarness({ discordApi: discord, env: DISCORD_ENV, plugins: { tournaments: false, admin: true } })
    try {
      const [a] = await makeUsers(h.db, 1)
      discord.user("c1", DISCORD_A)
      await h.ctx.discord.link(a!, "c1")
      const cookies = { rs_sid: h.app.signCookie(await h.ctx.sessions.create(ADMIN)) }
      const headers = { origin: "http://localhost:3000" }

      const got = await h.app.inject({ method: "GET", url: `/admin/users/${a}/discord`, cookies })
      expect(got.json()).toMatchObject({ enabled: true, link: { discordId: DISCORD_A } })

      const sync = await h.app.inject({ method: "POST", url: `/admin/users/${a}/discord/sync`, cookies, headers })
      expect(sync.json()).toMatchObject({ ok: true, link: { roleGranted: true } })

      const unlink = await h.app.inject({ method: "POST", url: `/admin/users/${a}/discord/unlink`, cookies, headers })
      expect(unlink.json()).toMatchObject({ ok: true, audit: { action: "user.discord_unlink" } })
      expect(discord.roles.size).toBe(0)

      const again = await h.app.inject({ method: "POST", url: `/admin/users/${a}/discord/unlink`, cookies, headers })
      expect(again.statusCode).toBe(409)

      const player = { rs_sid: h.app.signCookie(await h.ctx.sessions.create(a!)) }
      expect((await h.app.inject({ method: "GET", url: `/admin/users/${a}/discord`, cookies: player })).statusCode).toBe(404)
    } finally {
      await h.close()
    }
  })
})
