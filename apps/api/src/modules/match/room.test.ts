import { CONNECT_GRACE_SEC, generateMatchSlug, isMatchSlug } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, createTestDb, finishVeto, makeUsers, withServers } from "../../../test/helpers.js"
import { matches } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { newMatchSlug } from "./slug.js"

describe("match rooms", () => {
  let h: Awaited<ReturnType<typeof createAppHarness>>

  beforeAll(async () => {
    h = await createAppHarness({ rng: () => 0 })
  })
  afterAll(async () => {
    await h.close()
  })
  beforeEach(async () => {
    await createTestDb()
    await h.redis.flushall()
    h.notifier.clear()
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  })

  const cookieFor = async (steamId: string) => h.app.signCookie(await h.ctx.sessions.create(steamId))
  const get = (id: string, cookie?: string) =>
    h.app.inject({ method: "GET", url: `/matches/${id}`, ...(cookie ? { cookies: { rs_sid: cookie } } : {}) })

  async function found(): Promise<{ matchId: string; a: string; b: string }> {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now())
    return { matchId: matchId!, a, b }
  }

  it("gives every new match a room id and sends it with match found", async () => {
    const { matchId } = await found()
    const [row] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(isMatchSlug(row!.slug!)).toBe(true)
    const sent = h.notifier.ofType("match_found").map((s) => s.msg.payload as { slug?: string })
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((p) => p.slug === row!.slug)).toBe(true)
  })

  it("serves the match by room id and by uuid", async () => {
    const { matchId } = await found()
    const [row] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    const bySlug = (await get(row!.slug!)).json().match
    const byId = (await get(matchId)).json().match
    expect(bySlug.id).toBe(matchId)
    expect(byId.slug).toBe(row!.slug)
    expect((await get("quiet-amber-nobody")).statusCode).toBe(404)
    expect((await get("not a slug")).statusCode).toBe(404)
  })

  it("still serves older matches without a room id", async () => {
    const { matchId } = await found()
    await h.db.update(matches).set({ slug: null }).where(eq(matches.id, matchId))
    const res = await get(matchId)
    expect(res.statusCode).toBe(200)
    expect(res.json().match.slug).toBeUndefined()
  })

  it("gives participants the accept and veto step after a reload", async () => {
    const { matchId, a, b } = await found()
    const ca = await cookieFor(a)
    await h.ctx.flow.respond(a, matchId, true)
    let m = (await get(matchId, ca)).json().match
    expect(m.accept).toMatchObject({ accepted: 1, required: 2, responded: true, windowSec: 20 })
    expect(m.accept.acceptedSteamIds).toEqual([a])
    const sent = h.notifier.ofType("match_found").at(-1)!.msg.payload as { acceptedSteamIds?: string[] }
    expect(sent.acceptedSteamIds).toEqual([a])
    // Spectators see no step state
    expect((await get(matchId)).json().match.accept).toBeUndefined()
    const cb = await cookieFor(b)
    expect((await get(matchId, cb)).json().match.accept.responded).toBe(false)

    await h.ctx.flow.respond(b, matchId, true)
    m = (await get(matchId, ca)).json().match
    expect(m.status).toBe("veto")
    expect(m.veto.state.done).toBe(false)
    expect(typeof m.veto.stepDeadline).toBe("number")
    expect(m.accept).toBeUndefined()

    await finishVeto(h, matchId)
    m = (await get(matchId, ca)).json().match
    expect(m.veto).toBeUndefined()
    expect(m.warmup ?? { connected: 0 }).toMatchObject({ connected: 0 })
  })

  it("retries when a room id is taken", async () => {
    const { matchId } = await found()
    const taken = generateMatchSlug(3, () => 0)
    await h.db.update(matches).set({ slug: taken }).where(eq(matches.id, matchId))
    // A fixed rng draws the taken id on every three word try, so the generator moves to four words
    const slug = await newMatchSlug(h.db, () => 0)
    expect(slug).not.toBe(taken)
    expect(slug.split("-")).toHaveLength(4)
  })
  it("shows who is still missing and the connect deadline", async () => {
    const { matchId, a, b } = await found()
    await h.ctx.flow.respond(a, matchId, true)
    await h.ctx.flow.respond(b, matchId, true)
    await finishVeto(h, matchId)
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    const ready = h.notifier.ofType("server_ready").at(-1)!.msg.payload as { connectDeadline?: number }
    expect(ready.connectDeadline).toBe(h.ctx.now() + CONNECT_GRACE_SEC * 1000)
    await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: a })
    const update = h.notifier.ofType("match_update").at(-1)!.msg.payload as { missingSteamIds?: string[] }
    expect(update.missingSteamIds).toEqual([b])
    const m = (await get(matchId, await cookieFor(a))).json().match
    expect(m.warmup).toMatchObject({ connected: 1, expected: 2, missingSteamIds: [b], connectDeadline: ready.connectDeadline })
  })
})
