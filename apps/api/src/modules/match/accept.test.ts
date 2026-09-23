import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { cooldowns, matches, queueTickets } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { resolveAbandon, resolveAccept, type AcceptPlayer } from "./accept.js"

const p = (steamId: string, ticketId: string, accepted = false, declined = false): AcceptPlayer => ({
  steamId,
  ticketId,
  accepted,
  declined,
})

describe("resolveAccept", () => {
  it("waits while players are still deciding", () => {
    expect(resolveAccept([p("a", "t1", true), p("b", "t2")], false)).toEqual({ kind: "pending", accepted: 1, required: 2 })
  })

  it("proceeds when everyone accepted", () => {
    expect(resolveAccept([p("a", "t1", true), p("b", "t2", true)], false)).toEqual({ kind: "all_accepted" })
  })

  it("fails on a decline and blames only the decliner", () => {
    const out = resolveAccept([p("a", "t1", true), p("b", "t2", false, true), p("c", "t3")], false)
    expect(out).toMatchObject({ kind: "failed", reason: "declined", penalize: ["b"], dropTickets: ["t2"] })
    if (out.kind === "failed") expect(out.requeueTickets.sort()).toEqual(["t1", "t3"])
  })

  it("on timeout blames everyone who did not accept and drops their whole party", () => {
    const out = resolveAccept([p("a", "t1", true), p("b", "t1"), p("c", "t2", true), p("d", "t3")], true)
    expect(out).toMatchObject({ kind: "failed", reason: "timeout" })
    if (out.kind === "failed") {
      expect(out.penalize.sort()).toEqual(["b", "d"])
      expect(out.dropTickets.sort()).toEqual(["t1", "t3"])
      expect(out.requeueTickets).toEqual(["t2"])
    }
  })
})

describe("resolveAbandon", () => {
  it("makes the team with missing players forfeit", () => {
    expect(resolveAbandon([["a", "b"], ["c", "d"]], ["b"])).toEqual({ kind: "forfeit", loserTeam: 0, forfeiters: ["b"] })
  })

  it("voids the match when both teams are missing someone", () => {
    expect(resolveAbandon([["a"], ["c"]], ["a", "c"])).toEqual({ kind: "void", forfeiters: ["a", "c"] })
  })
})

describe("accept flow", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
  })
  afterEach(async () => {
    await h.close()
  })

  async function found(): Promise<{ a: string; b: string; matchId: string }> {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    expect(matchId).toBeDefined()
    return { a, b, matchId: matchId! }
  }

  it("opens a 20 second window and moves to the veto once both accept", async () => {
    const { a, b, matchId } = await found()
    const mf = h.notifier.ofType("match_found")
    expect(mf).toHaveLength(1)
    expect(mf[0]!.msg.payload).toMatchObject({ matchId, required: 2, accepted: 0, acceptWindowSec: 20 })
    expect((mf[0]!.msg.payload as { acceptDeadline: number }).acceptDeadline).toBe(h.clock.now() + 20_000)

    await h.ctx.flow.respond(a, matchId, true)
    let [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("accepting")
    await h.ctx.flow.respond(b, matchId, true)
    ;[m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("veto")
    expect(h.notifier.ofType("veto_state").length).toBeGreaterThan(0)
  })

  it("a decline cancels, gives the decliner a cooldown and requeues the other player", async () => {
    const { a, b, matchId } = await found()
    const queuedAt = (await h.ctx.queue.status(a)).modes
    await h.ctx.flow.respond(a, matchId, true)
    h.clock.advance(3000)
    await h.ctx.flow.respond(b, matchId, false)
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("cancelled")
    const cds = await h.db.select().from(cooldowns).where(eq(cooldowns.steamId, b))
    expect(cds).toHaveLength(1)
    expect(cds[0]!.reason).toBe("decline")
    const sa = await h.ctx.queue.status(a)
    expect(sa.state).toBe("queued")
    expect(sa.modes[0]!.mode).toBe("aim1v1")
    expect(queuedAt).toEqual([])
    const sb = await h.ctx.queue.status(b)
    expect(sb.state).toBe("cooldown")
    await expect(h.ctx.queue.join(b, ["aim1v1"])).rejects.toMatchObject({ code: "cooldown" })
  })

  it("a timeout penalises the player who never answered", async () => {
    const { a, b, matchId } = await found()
    await h.ctx.flow.respond(a, matchId, true)
    h.clock.advance(21_000)
    await h.ctx.flow.tick()
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("cancelled")
    expect(m!.cancelReason).toBe("accept_timeout")
    const cds = await h.db.select().from(cooldowns).where(eq(cooldowns.steamId, b))
    expect(cds[0]!.reason).toBe("accept_timeout")
    expect((await h.ctx.queue.status(a)).state).toBe("queued")
    await expect(h.ctx.flow.respond(b, matchId, true)).rejects.toMatchObject({ code: "not_accepting" })
  })

  it("escalates repeat decline cooldowns", async () => {
    const [x] = await makeUsers(h.db, 1)
    const first = await h.ctx.cooldowns.issue(x!, "decline", null)
    h.clock.advance(first.endsAt - h.clock.now() + 1)
    const second = await h.ctx.cooldowns.issue(x!, "decline", null)
    expect(second.endsAt - h.clock.now()).toBeGreaterThan(first.endsAt - (first.endsAt - 60_000))
  })

  it("a ticket in several modes is consumed once and leaves every other mode", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await h.ctx.queue.join(a, ["aim1v1", "aim2v2", "rush3v3"])
    await h.ctx.queue.join(b, ["aim1v1", "rush3v3"])
    expect((await h.ctx.queue.status(a)).modes.map((m) => m.mode).sort()).toEqual(["aim1v1", "aim2v2", "rush3v3"])
    const created = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    expect(created).toHaveLength(1)
    expect(await h.ctx.queue.waiting("aim2v2")).toHaveLength(0)
    expect(await h.ctx.queue.waiting("rush3v3")).toHaveLength(0)
    const rows = await h.db.select().from(queueTickets)
    expect(rows.every((r) => r.status === "matched" && r.matchedMode === "aim1v1")).toBe(true)
  })

  it("a second claim of the same ticket loses", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const t = await h.ctx.queue.join(a, ["aim1v1", "aim2v2"])
    const first = await h.ctx.queue.claim([t.id], "00000000-0000-4000-8000-000000000001", "aim1v1")
    const second = await h.ctx.queue.claim([t.id], "00000000-0000-4000-8000-000000000002", "aim2v2")
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: false, lost: [t.id] })
  })

  it("rejects a mode that is too small for the party", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const party = await h.ctx.parties.create(a)
    await h.ctx.parties.join(b, party.inviteToken)
    await expect(h.ctx.queue.join(a, ["aim1v1", "aim2v2"])).rejects.toMatchObject({ code: "party_too_large" })
    await h.ctx.queue.join(a, ["aim2v2", "rush3v3"])
    expect((await h.ctx.queue.status(b)).state).toBe("queued")
  })
})
