import { TRUST_LEVELS, type TrustLevel } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"
import { createAppHarness, createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { queueTickets } from "../../db/schema.js"
import { findMatches, trustCompatible, type MmTicket } from "./matchmaker.js"

const NOW = 1_000_000_000
const rank = (l: TrustLevel) => TRUST_LEVELS.indexOf(l)
let n = 0
const t = (trust: TrustLevel, minTrust: TrustLevel, opts: { size?: number; rating?: number; waitSec?: number } = {}): MmTicket => ({
  id: `g${++n}`,
  size: opts.size ?? 1,
  rating: opts.rating ?? 1500,
  enqueuedAt: NOW - (opts.waitSec ?? 0) * 1000,
  region: "eu",
  trust: rank(trust),
  minTrust: rank(minTrust),
})

describe("trust compatibility in findMatches", () => {
  const combos = TRUST_LEVELS.flatMap((trust) => TRUST_LEVELS.map((min) => [trust, min] as const))

  it.each(combos.flatMap((a) => combos.map((b) => [a, b] as const)))(
    "1v1 %j against %j matches only when each meets the other's floor",
    ([aTrust, aMin], [bTrust, bMin]) => {
      const a = t(aTrust, aMin, { waitSec: 10 })
      const b = t(bTrust, bMin)
      const ok = rank(bTrust) >= rank(aMin) && rank(aTrust) >= rank(bMin)
      expect(trustCompatible(a, b)).toBe(ok)
      expect(findMatches([a, b], { mode: "aim1v1", teamSize: 1, now: NOW })).toHaveLength(ok ? 1 : 0)
    },
  )

  it("never relaxes the floor however long the wait", () => {
    const a = t("new", "trusted", { waitSec: 100_000 })
    const b = t("verified", "new", { waitSec: 100_000 })
    expect(findMatches([a, b], { mode: "aim1v1", teamSize: 1, now: NOW })).toHaveLength(0)
  })

  it("checks the floor before the rating window so a far compatible opponent still counts", () => {
    const anchor = t("trusted", "verified", { waitSec: 20 })
    const crowd = Array.from({ length: 12 }, (_, i) => t("new", "new", { rating: 1500 + i }))
    const far = t("verified", "new", { rating: 1580 })
    const out = findMatches([anchor, ...crowd, far], { mode: "aim1v1", teamSize: 1, now: NOW })
    const withAnchor = out.find((p) => [...p.teams[0], ...p.teams[1]].some((x) => x.id === anchor.id))
    expect(withAnchor).toBeDefined()
    expect([...withAnchor!.teams[0], ...withAnchor!.teams[1]].map((x) => x.id)).toContain(far.id)
  })

  it("applies every ticket's floor to opponents in team modes", () => {
    // The strict duo refuses any team with a new player, the other side has one
    const strict = t("verified", "verified", { size: 2, waitSec: 10 })
    const mates = [t("verified", "new"), t("new", "new")]
    expect(findMatches([strict, ...mates], { mode: "aim2v2", teamSize: 2, now: NOW, canMix: () => true })).toHaveLength(0)
    const clean = [t("verified", "new"), t("trusted", "new")]
    expect(findMatches([strict, ...clean], { mode: "aim2v2", teamSize: 2, now: NOW, canMix: () => true })).toHaveLength(1)
  })

  it("applies the floor to auto-filled teammates too", () => {
    // Four solos for 2v2. The strict one must not be paired with the new player on either side
    const strict = t("verified", "verified", { waitSec: 10 })
    const others = [t("verified", "new"), t("trusted", "new"), t("new", "new")]
    expect(findMatches([strict, ...others], { mode: "aim2v2", teamSize: 2, now: NOW })).toHaveLength(0)
    const fifth = t("verified", "new", { rating: 1501 })
    const out = findMatches([strict, ...others, fifth], { mode: "aim2v2", teamSize: 2, now: NOW })
    expect(out).toHaveLength(1)
    const ids = [...out[0]!.teams[0], ...out[0]!.teams[1]].map((x) => x.id)
    expect(ids).toContain(strict.id)
    expect(ids).not.toContain(others[2]!.id)
  })

  it("keeps a strict teammate out of a team with a new player even when opponents qualify", () => {
    const strict = t("trusted", "trusted", { waitSec: 10 })
    const newMate = t("new", "new")
    const opp = [t("trusted", "new"), t("trusted", "new")]
    expect(findMatches([strict, newMate, ...opp], { mode: "aim2v2", teamSize: 2, now: NOW })).toHaveLength(0)
  })
})

describe("minTrust on the queue", () => {
  let h: Harness
  afterEach(async () => {
    await h?.close()
  })

  it("stores the floor and player trust on the ticket and echoes it in queue_status", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await h.ctx.bans.setTrustLevel(a!, "verified")
    const ticket = await h.ctx.queue.join(a!, ["aim1v1"], "verified")
    expect(ticket.minTrust).toBe("verified")
    const [row] = await h.db.select().from(queueTickets).where(eq(queueTickets.id, ticket.id))
    expect(row!.minTrust).toBe("verified")
    expect(row!.playerTrust).toEqual({ [a!]: "verified" })
    expect((await h.ctx.queue.status(a!)).minTrust).toBe("verified")
  })

  it("rejects a floor above the party's lowest trust level", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    await expect(h.ctx.queue.join(a!, ["aim1v1"], "verified")).rejects.toMatchObject({ statusCode: 400, code: "min_trust_above_own" })
  })

  it("applies the saved preference when omitted and lowers it to what the party meets", async () => {
    h = await createHarness()
    const [leader, member] = await makeUsers(h.db, 2)
    await h.ctx.bans.setTrustLevel(leader!, "trusted")
    await h.ctx.queue.updateSettings(leader!, { minTrust: "trusted" })
    expect((await h.ctx.queue.join(leader!, ["aim2v2"])).minTrust).toBe("trusted")
    await h.ctx.queue.leave(leader!)

    const party = await h.ctx.parties.ensure(leader!)
    await h.ctx.parties.join(member!, party.inviteToken)
    expect((await h.ctx.queue.join(leader!, ["aim2v2"])).minTrust).toBe("new")
    expect((await h.ctx.queue.getSettings(leader!)).minTrust).toBe("trusted")
  })

  it("refreshes player trust on requeue", async () => {
    h = await createHarness()
    const [a] = await makeUsers(h.db, 1)
    const ticket = await h.ctx.queue.join(a!, ["aim1v1"])
    await h.ctx.queue.claim([ticket.id], "00000000-0000-4000-8000-000000000001", "aim1v1")
    await h.ctx.bans.setTrustLevel(a!, "trusted")
    await h.ctx.queue.requeue(ticket.id)
    expect((await h.ctx.queue.ticket(ticket.id))!.trust).toEqual({ [a!]: "trusted" })
  })
})

describe("user settings routes", () => {
  it("persists minTrust, shows it on GET /me and refuses a level above your own", async () => {
    const a = await createAppHarness()
    try {
      const [me] = await makeUsers(a.db, 1)
      const cookies = { rs_sid: a.app.signCookie(await a.ctx.sessions.create(me!)) }
      const get = async () => (await a.app.inject({ method: "GET", url: "/me", cookies })).json().settings
      expect(await get()).toEqual({ minTrust: "new" })

      const above = await a.app.inject({ method: "PATCH", url: "/me/settings", cookies, payload: { minTrust: "verified" } })
      expect(above.statusCode).toBe(400)
      expect(above.json().error).toBe("min_trust_above_own")

      await a.ctx.bans.setTrustLevel(me!, "verified")
      const ok = await a.app.inject({ method: "PATCH", url: "/me/settings", cookies, payload: { minTrust: "verified" } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json()).toEqual({ minTrust: "verified" })
      expect(await get()).toEqual({ minTrust: "verified" })

      const bad = await a.app.inject({ method: "PATCH", url: "/me/settings", cookies, payload: { minTrust: "elite" } })
      expect(bad.statusCode).toBe(400)
    } finally {
      await a.close()
    }
  })

  it("puts each member's trust level on party rows", async () => {
    const a = await createAppHarness()
    try {
      const [me] = await makeUsers(a.db, 1)
      await a.ctx.bans.setTrustLevel(me!, "verified")
      const party = await a.ctx.parties.ensure(me!)
      const payload = await a.ctx.parties.payload(party)
      expect(payload.members[0]!.trustLevel).toBe("verified")
    } finally {
      await a.close()
    }
  })
})
