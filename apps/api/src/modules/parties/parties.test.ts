import type { PartyUpdatePayload } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, makeUsers } from "../../../test/helpers.js"
import { parties, partyMembers, queueTickets } from "../../db/schema.js"

type H = Awaited<ReturnType<typeof createAppHarness>>

describe("parties", () => {
  let h: H
  let A: string, B: string, C: string, D: string

  beforeEach(async () => {
    h = await createAppHarness()
    ;[A, B, C, D] = (await makeUsers(h.db, 4)) as [string, string, string, string]
  })
  afterEach(async () => {
    await h.close()
  })

  const cookies = new Map<string, string>()
  const cookie = async (id: string) => {
    if (!cookies.has(id)) cookies.set(id, h.app.signCookie(await h.ctx.sessions.create(id)))
    return { rs_sid: cookies.get(id)! }
  }
  beforeEach(() => cookies.clear())

  async function call(as: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) {
    const res = await h.app.inject({ method, url, cookies: await cookie(as), ...(payload ? { payload } : {}) })
    return { status: res.statusCode, body: (res.body ? res.json() : {}) as PartyUpdatePayload & { error?: string } }
  }
  const me = async (id: string) => (await call(id, "GET", "/parties/me")).body
  const ids = (p: PartyUpdatePayload) => p.members.map((m) => m.steamId)
  // Last party_update each user received
  const lastUpdate = (id: string) =>
    h.notifier
      .ofType("party_update")
      .filter((s) => s.audience.kind === "users" && s.audience.steamIds.includes(id))
      .at(-1)?.msg.payload as PartyUpdatePayload | undefined

  async function partyOf(leader: string, ...joiners: string[]) {
    const code = (await call(leader, "POST", "/parties")).body.inviteCode!
    for (const j of joiners) expect((await call(j, "POST", `/parties/join/${code}`)).status).toBe(200)
    return code
  }

  it("joins by code and tells every member", async () => {
    await partyOf(A, B)
    for (const id of [A, B]) {
      expect(ids(lastUpdate(id)!)).toEqual([A, B])
      expect(lastUpdate(id)!.leaderSteamId).toBe(A)
    }
  })

  it("allows DELETE from the site origin so the web can kick", async () => {
    const res = await h.app.inject({
      method: "OPTIONS",
      url: `/parties/members/${B}`,
      headers: { origin: "http://localhost:3000", "access-control-request-method": "DELETE" },
    })
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE")
  })

  it("transfers leadership and only the leader may", async () => {
    await partyOf(A, B)
    expect((await call(A, "POST", "/parties/leader", { steamId: B })).body.leaderSteamId).toBe(B)
    expect(lastUpdate(A)!.leaderSteamId).toBe(B)
    expect((await call(A, "POST", "/parties/leader", { steamId: A })).status).toBe(403)
    expect((await call(B, "POST", "/parties/leader", { steamId: C })).status).toBe(400)
    expect((await call(B, "POST", "/parties/leader", { steamId: A })).body.leaderSteamId).toBe(A)
  })

  it("kicks a member, who gets an empty party, and a member cannot kick", async () => {
    await partyOf(A, B, C)
    expect((await call(B, "DELETE", `/parties/members/${C}`)).status).toBe(403)
    expect((await call(A, "DELETE", `/parties/members/${A}`)).status).toBe(400)
    expect((await call(A, "DELETE", `/parties/members/${D}`)).status).toBe(400)
    const r = await call(A, "DELETE", `/parties/members/${B}`)
    expect(ids(r.body)).toEqual([A, C])
    expect(lastUpdate(B)!.partyId).toBeNull()
    expect(ids(lastUpdate(C)!)).toEqual([A, C])
    expect((await me(B)).partyId).toBeNull()
  })

  it("promotes the earliest joiner when the leader leaves and disbands when empty", async () => {
    await partyOf(A, B, C)
    const partyId = (await me(A)).partyId!
    expect((await call(A, "POST", "/parties/leave")).status).toBe(204)
    expect(lastUpdate(A)!.partyId).toBeNull()
    expect((await me(C)).leaderSteamId).toBe(B)
    await call(B, "POST", "/parties/leave")
    await call(C, "POST", "/parties/leave")
    const [row] = await h.db.select().from(parties).where(eq(parties.id, partyId))
    expect(row!.disbandedAt).not.toBeNull()
    expect((await call(C, "POST", "/parties/leave")).status).toBe(204)
  })

  it("refuses a fourth player and invalid or rotated codes", async () => {
    const code = await partyOf(A, B, C)
    const full = await call(D, "POST", `/parties/join/${code}`)
    expect(full.status).toBe(409)
    expect(full.body.error).toBe("party_full")
    expect((await call(D, "POST", "/parties/join/nope")).status).toBe(404)
    await call(A, "DELETE", `/parties/members/${C}`)
    const next = (await call(A, "POST", "/parties/invite")).body.inviteCode!
    expect(next).not.toBe(code)
    expect((await call(D, "POST", `/parties/join/${code}`)).status).toBe(404)
    expect((await call(D, "POST", `/parties/join/${next}`)).status).toBe(200)
  })

  it("previews an invite for signed out and signed in viewers", async () => {
    const code = await partyOf(A, B)
    const anon = await h.app.inject({ method: "GET", url: `/parties/join/${code}` })
    expect(anon.statusCode).toBe(200)
    expect(anon.json()).toMatchObject({ leader: { steamId: A }, size: 2, capacity: 3, full: false, isMember: false })
    const member = await h.app.inject({ method: "GET", url: `/parties/join/${code}`, cookies: await cookie(B) })
    expect(member.json()).toMatchObject({ isMember: true })
    await call(C, "POST", `/parties/join/${code}`)
    expect((await h.app.inject({ method: "GET", url: `/parties/join/${code}` })).json()).toMatchObject({ full: true, size: 3 })
    await call(A, "POST", "/parties/invite")
    const old = await h.app.inject({ method: "GET", url: `/parties/join/${code}` })
    expect(old.statusCode).toBe(404)
    expect(old.json().error).toBe("invite_not_found")
  })

  it("never overfills a party on concurrent joins", async () => {
    const code = await partyOf(A, B)
    const rs = await Promise.all([call(C, "POST", `/parties/join/${code}`), call(D, "POST", `/parties/join/${code}`)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await me(A)).members).toHaveLength(3)
  })

  it("keeps a member as leader when the leader and another member leave at once", async () => {
    await partyOf(A, B, C)
    await Promise.all([call(A, "POST", "/parties/leave"), call(B, "POST", "/parties/leave")])
    const p = await me(C)
    expect(ids(p)).toEqual([C])
    expect(p.leaderSteamId).toBe(C)
  })

  it("disbands when the last two leave at once", async () => {
    await partyOf(A, B)
    const partyId = (await me(A)).partyId!
    await Promise.all([call(A, "POST", "/parties/leave"), call(B, "POST", "/parties/leave")])
    const [row] = await h.db.select().from(parties).where(eq(parties.id, partyId))
    expect(row!.disbandedAt).not.toBeNull()
    expect(await h.db.select().from(partyMembers).where(eq(partyMembers.partyId, partyId))).toHaveLength(0)
  })

  it("survives a double create without a server error", async () => {
    const rs = await Promise.all([call(A, "POST", "/parties"), call(A, "POST", "/parties")])
    expect(rs.map((r) => r.status)).toEqual([200, 200])
    expect(rs[0]!.body.partyId).toBe(rs[1]!.body.partyId)
  })

  it("cancels the queue ticket of the joined party and of the joiner", async () => {
    const code = (await call(A, "POST", "/parties")).body.inviteCode!
    await h.ctx.queue.join(A, ["rush3v3"])
    await h.ctx.queue.join(B, ["rush3v3"])
    const bParty = (await me(B)).partyId!
    await call(B, "POST", `/parties/join/${code}`)
    const waiting = await h.db.select().from(queueTickets).where(eq(queueTickets.status, "waiting"))
    expect(waiting).toHaveLength(0)
    expect((await h.ctx.queue.status(A)).state).not.toBe("queued")
    const [old] = await h.db.select().from(parties).where(eq(parties.id, bParty))
    expect(old!.disbandedAt).not.toBeNull()
  })

  it("cancels the ticket when a member is kicked", async () => {
    await partyOf(A, B)
    await h.ctx.queue.join(A, ["rush3v3"])
    await call(A, "DELETE", `/parties/members/${B}`)
    expect(await h.db.select().from(queueTickets).where(eq(queueTickets.status, "waiting"))).toHaveLength(0)
  })
})
