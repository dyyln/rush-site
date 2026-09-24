import { CHAT_LIMITS, CHAT_MAX_LENGTH, CHAT_RATE, CHAT_SLOW_MODE_FLAG, type ChatHistoryResponse, type ChatMessage } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import type { InjectOptions } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { adminAudit, ratings, trustLevels, users } from "../../db/schema.js"

const ADMIN = "76561198999999997"
type H = Awaited<ReturnType<typeof createAppHarness>>
type Method = "GET" | "POST" | "PUT" | "DELETE"
let h: H

afterEach(async () => {
  await h?.close()
})

async function setup(admin = false) {
  h = await createAppHarness({ plugins: { tournaments: false, admin }, env: { ADMIN_STEAM_IDS: ADMIN } })
  await h.db.insert(users).values({ steamId: ADMIN, displayName: "boss" })
  const as = async (steamId: string | null, method: Method, url: string, payload?: unknown) => {
    const cookies: Record<string, string> = steamId ? { rs_sid: h.app.signCookie(await h.ctx.sessions.create(steamId)) } : {}
    const opts: InjectOptions = { method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) }
    return h.app.inject(opts)
  }
  const history = async (viewer: string | null = null, query = "") =>
    (await as(viewer, "GET", `/chat/messages${query}`)).json() as ChatHistoryResponse
  return { as, history }
}

describe("chat", () => {
  it("lets guests read, signed in users post, and broadcasts new messages", async () => {
    const { as, history } = await setup()
    const [a] = await makeUsers(h.db, 1)
    await h.db.insert(trustLevels).values({ steamId: a!, level: "verified" })
    await h.db.insert(ratings).values([
      { steamId: a!, mode: "aim1v1", rating: 1650, rd: 80, volatility: 0.06, matchesPlayed: 4 },
      { steamId: a!, mode: "rush3v3", rating: 2400, rd: 80, volatility: 0.06, matchesPlayed: 0 },
    ])

    expect(await history()).toEqual({ channel: "global", messages: [] })
    expect((await as(null, "POST", "/chat/messages", { body: "hi" })).statusCode).toBe(401)

    const res = await as(a!, "POST", "/chat/messages", { body: "  gl hf \u0007 " })
    expect(res.statusCode).toBe(201)
    const message = (res.json() as { message: ChatMessage }).message
    expect(message).toMatchObject({
      channel: "global",
      body: "gl hf",
      author: { steamId: a, displayName: `player-${a!.slice(-4)}`, trustLevel: "verified", tier: "gold", admin: false },
    })

    const sent = h.notifier.ofType("chat_message")
    expect(sent).toHaveLength(1)
    expect(sent[0]!.audience).toEqual({ kind: "broadcast" })
    expect(sent[0]!.msg.payload).toEqual(message)

    const guest = await history()
    expect(guest.messages).toEqual([message])
    expect(guest.me).toBeUndefined()
    expect((await history(a!)).me).toEqual({ muted: null })
  })

  it("validates the body and the channel", async () => {
    const { as } = await setup()
    const [a] = await makeUsers(h.db, 1)
    const post = (payload: unknown) => as(a!, "POST", "/chat/messages", payload)

    expect((await post({ body: "   " })).json()).toMatchObject({ error: "invalid_body" })
    expect((await post({ body: "x".repeat(CHAT_MAX_LENGTH + 1) })).statusCode).toBe(400)
    expect((await post({ body: "x".repeat(CHAT_MAX_LENGTH) })).statusCode).toBe(201)
    expect((await post({ channel: "lobby", body: "hi" })).statusCode).toBe(400)
    // Match channels are valid ids but not open yet
    expect((await post({ channel: "match:quiet-amber-fox", body: "hi" })).json()).toMatchObject({ error: "channel_not_found" })
    expect((await as(null, "GET", "/chat/messages?channel=match:abc")).statusCode).toBe(404)
  })

  it("limits posts per user and escalates the cooldown on repeats", async () => {
    const { as } = await setup()
    const [a, b] = await makeUsers(h.db, 2)
    const [first, second] = CHAT_LIMITS.cooldownStepsSec
    // Start of a window so the whole burst lands in one
    const alignWindow = () => {
      const w = CHAT_RATE.windowSec * 1000
      h.clock.t = Math.ceil(h.clock.t / w) * w
    }
    alignWindow()
    const post = (id: string, body: string) => as(id, "POST", "/chat/messages", { body })
    const lines = ["gl hf", "nice shot", "rush tonight", "who wants 2v2", "aim map pick", "brb", "ready up", "good veto", "close one", "rematch"]
    let n = 0
    const burst = async () => {
      for (let i = 0; i < CHAT_RATE.max; i++) expect((await post(a!, lines[n++]!)).statusCode).toBe(201)
    }

    await burst()
    const limited = await post(a!, "one more")
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ error: "chat_rate_limited", details: { retryAfterSec: first } })
    // Other users have their own budget
    expect((await post(b!, "hello")).statusCode).toBe(201)

    // The cooldown outlasts the rate window
    h.clock.advance(CHAT_RATE.windowSec * 1000)
    expect((await post(a!, "still waiting")).json()).toMatchObject({ error: "chat_rate_limited", details: { retryAfterSec: first! - CHAT_RATE.windowSec } })
    h.clock.advance(first! * 1000)
    alignWindow()
    await burst()
    // A second offence waits longer
    expect((await post(a!, "again")).json()).toMatchObject({ error: "chat_rate_limited", details: { retryAfterSec: second } })
  })

  it("refuses the same or nearly the same text inside the duplicate window", async () => {
    const { as } = await setup()
    const [a] = await makeUsers(h.db, 1)
    const post = (body: string) => as(a!, "POST", "/chat/messages", { body })
    expect((await post("anyone for rush")).statusCode).toBe(201)
    h.clock.advance(5_000)
    const dup = await post("Anyone for RUSH!!")
    expect(dup.statusCode).toBe(429)
    expect(dup.json()).toMatchObject({ error: "chat_duplicate", details: { retryAfterSec: CHAT_LIMITS.duplicateWindowSec - 5 } })
    expect((await post("anyone for rushh pls")).json()).toMatchObject({ error: "chat_duplicate" })
    expect((await post("gg that was close")).statusCode).toBe(201)
    h.clock.advance(CHAT_LIMITS.duplicateWindowSec * 1000)
    expect((await post("anyone for rush")).statusCode).toBe(201)
  })

  it("masks profanity, keeps the original for admins, and logs refused messages", async () => {
    const { as, history } = await setup(true)
    const [a] = await makeUsers(h.db, 1)
    const masked = await as(a!, "POST", "/chat/messages", { body: "that round was sh1t" })
    expect(masked.statusCode).toBe(201)
    expect((masked.json() as { message: ChatMessage }).message).not.toHaveProperty("originalBody")
    expect((masked.json() as { message: ChatMessage }).message.body).toBe("that round was s***")

    expect((await history()).messages[0]).not.toHaveProperty("originalBody")
    expect((await history(a!)).messages[0]).not.toHaveProperty("originalBody")
    expect((await history(ADMIN)).messages[0]).toMatchObject({ body: "that round was s***", originalBody: "that round was sh1t" })

    const refused = await as(a!, "POST", "/chat/messages", { body: "free skins at https://steamcommunlty.com/gift" })
    expect(refused.statusCode).toBe(400)
    expect(refused.json()).toMatchObject({ error: "chat_scam_link" })
    expect((await as(a!, "POST", "/chat/messages", { body: "you r3tard" })).json()).toMatchObject({ error: "chat_blocked_language" })
    expect((await history()).messages).toHaveLength(1)

    const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.target, a!))
    expect(audit.map((r) => [r.adminSteamId, r.action])).toEqual([
      ["system", "chat.refused"],
      ["system", "chat.refused"],
    ])
    expect(audit.map((r) => (r.payload as { code: string }).code).sort()).toEqual(["chat_blocked_language", "chat_scam_link"])
    const events = h.notifier.ofType("admin_event").filter((e) => e.audience.kind === "admins")
    expect(events.map((e) => (e.msg.payload as { payload: { action: string } }).payload.action)).toEqual(["chat_refused", "chat_refused"])

    // Admin deletes audit the original text
    const id = (masked.json() as { message: ChatMessage }).message.id
    await as(ADMIN, "DELETE", `/admin/chat/messages/${id}`)
    const [del] = await h.db.select().from(adminAudit).where(eq(adminAudit.action, "chat.delete"))
    expect(del?.payload).toMatchObject({ body: "that round was sh1t" })
  })

  it("applies the global slow mode from the flag to everyone but admins", async () => {
    const { as, history } = await setup(true)
    const [a] = await makeUsers(h.db, 1)
    await as(ADMIN, "PUT", `/admin/flags/${CHAT_SLOW_MODE_FLAG}`, { enabled: true, value: { seconds: 20 } })
    expect((await history()).slowModeSec).toBe(20)

    expect((await as(a!, "POST", "/chat/messages", { body: "first" })).statusCode).toBe(201)
    h.clock.advance(5_000)
    expect((await as(a!, "POST", "/chat/messages", { body: "second" })).json()).toMatchObject({
      error: "chat_slow_mode",
      details: { retryAfterSec: 15 },
    })
    expect((await as(ADMIN, "POST", "/chat/messages", { body: "admins skip it" })).statusCode).toBe(201)
    expect((await as(ADMIN, "POST", "/chat/messages", { body: "right away" })).statusCode).toBe(201)
    h.clock.advance(15_000)
    expect((await as(a!, "POST", "/chat/messages", { body: "second" })).statusCode).toBe(201)

    await as(ADMIN, "PUT", `/admin/flags/${CHAT_SLOW_MODE_FLAG}`, { enabled: false })
    expect((await history()).slowModeSec).toBeUndefined()
    expect((await as(a!, "POST", "/chat/messages", { body: "third" })).statusCode).toBe(201)
  })

  it("blocks banned and muted users", async () => {
    const { as, history } = await setup()
    const [a, b] = await makeUsers(h.db, 2)
    await h.ctx.bans.ban(a!, "cheating")
    const banned = await as(a!, "POST", "/chat/messages", { body: "hi" })
    expect(banned.statusCode).toBe(401)
    expect(banned.json()).toMatchObject({ error: "banned" })

    await h.ctx.chat.mute(b!, new Date(h.clock.now() + 60_000), "spam", ADMIN)
    const muted = await as(b!, "POST", "/chat/messages", { body: "hi" })
    expect(muted.statusCode).toBe(403)
    expect(muted.json()).toMatchObject({ error: "chat_muted", details: { reason: "spam" } })
    expect((await history(b!)).me?.muted).toMatchObject({ reason: "spam" })

    h.clock.advance(61_000)
    expect((await as(b!, "POST", "/chat/messages", { body: "hi again" })).statusCode).toBe(201)
    expect(h.notifier.ofType("chat_message")).toHaveLength(1)
  })

  it("pages back through history with before", async () => {
    const { history } = await setup()
    const [a] = await makeUsers(h.db, 1)
    for (let i = 0; i < 4; i++) {
      await h.ctx.chat.post(a!, "global", `m${i}`)
      h.clock.advance(CHAT_RATE.windowSec * 1000)
    }
    const latest = await history(null, "?limit=2")
    expect(latest.messages.map((m) => m.body)).toEqual(["m2", "m3"])
    const older = await history(null, `?limit=2&before=${encodeURIComponent(latest.messages[0]!.createdAt)}`)
    expect(older.messages.map((m) => m.body)).toEqual(["m0", "m1"])
  })
})

describe("chat moderation", () => {
  it("deletes messages, mutes and unmutes, and audits each action", async () => {
    const { as, history } = await setup(true)
    const [a] = await makeUsers(h.db, 1)
    const message = ((await as(a!, "POST", "/chat/messages", { body: "rude" })).json() as { message: ChatMessage }).message

    // Admin routes are hidden from everyone else
    expect((await as(a!, "DELETE", `/admin/chat/messages/${message.id}`)).statusCode).toBe(404)

    expect((await as(ADMIN, "DELETE", `/admin/chat/messages/${message.id}`)).statusCode).toBe(200)
    expect((await as(ADMIN, "DELETE", `/admin/chat/messages/${message.id}`)).statusCode).toBe(404)
    expect((await history()).messages).toEqual([])
    const deleted = h.notifier.ofType("chat_deleted")
    expect(deleted.map((d) => d.msg.payload)).toEqual([{ id: message.id, channel: "global" }])
    expect(deleted[0]!.audience).toEqual({ kind: "broadcast" })

    expect((await as(ADMIN, "PUT", `/admin/chat/mutes/${a}`, { minutes: 0, reason: "x" })).statusCode).toBe(400)
    expect((await as(ADMIN, "PUT", `/admin/chat/mutes/${ADMIN}`, { minutes: 10, reason: "x" })).statusCode).toBe(400)
    const mute = await as(ADMIN, "PUT", `/admin/chat/mutes/${a}`, { minutes: null, reason: "abuse" })
    expect(mute.statusCode).toBe(200)
    expect(mute.json()).toMatchObject({ mute: { until: null, reason: "abuse" } })
    expect((await as(a!, "POST", "/chat/messages", { body: "hi" })).statusCode).toBe(403)

    const list = (await as(ADMIN, "GET", "/admin/chat/mutes")).json() as { mutes: { steamId: string; mutedBy: string }[] }
    expect(list.mutes).toMatchObject([{ steamId: a, mutedBy: ADMIN }])

    expect((await as(ADMIN, "DELETE", `/admin/chat/mutes/${a}`)).statusCode).toBe(200)
    expect((await as(ADMIN, "DELETE", `/admin/chat/mutes/${a}`)).statusCode).toBe(404)
    expect((await as(a!, "POST", "/chat/messages", { body: "sorry" })).statusCode).toBe(201)

    const audit = await h.db.select().from(adminAudit).where(eq(adminAudit.target, a!))
    expect(audit.map((r) => r.action).sort()).toEqual(["chat.delete", "chat.mute", "chat.unmute"])
    expect(audit.find((r) => r.action === "chat.delete")?.payload).toMatchObject({ messageId: message.id, body: "rude" })
  })

  it("marks admin authors", async () => {
    const { as } = await setup(true)
    const res = await as(ADMIN, "POST", "/chat/messages", { body: "server restart in 5" })
    expect((res.json() as { message: ChatMessage }).message.author).toMatchObject({ admin: true, tier: "unranked", trustLevel: "new" })
  })
})
