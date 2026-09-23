import type { Challenge, VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAppHarness, finishVeto, makeUsers, withServers } from "../../../test/helpers.js"
import { matchPlayers, matches, queueTickets, ratingEvents, vetoes } from "../../db/schema.js"
import { challenges } from "./schema.js"

type H = Awaited<ReturnType<typeof createAppHarness>>

describe("challenges", () => {
  let h: H
  beforeEach(async () => {
    h = await createAppHarness({ rng: () => 0 })
    await withServers({ ctx: h.ctx, env: h.ctx.env })
  })
  afterEach(async () => {
    await h.close()
  })

  const cookie = async (steamId: string) => ({ rs_sid: h.app.signCookie(await h.ctx.sessions.create(steamId)) })

  async function call(as: string | null, method: "GET" | "POST", url: string, payload?: unknown) {
    const res = await h.app.inject({ method, url, ...(as ? { cookies: await cookie(as) } : {}), ...(payload ? { payload } : {}) })
    return { status: res.statusCode, body: res.json() as Record<string, unknown> & { challenge: Challenge } }
  }

  const create = (as: string, body: Record<string, unknown>) => call(as, "POST", "/challenges", body)

  async function finishedMatch(mode: "aim1v1" | "aim2v2", a: string[], b: string[]) {
    const { matchId } = await h.ctx.flow.createDirectMatch({
      mode,
      teams: [
        { name: "A", steamIds: a },
        { name: "B", steamIds: b },
      ],
    })
    await h.ctx.flow.finishMatch(matchId, { type: "match_end", winnerTeam: "A", score: { A: 16, B: 9 }, players: [], demoUploaded: false })
    return matchId
  }

  async function party(ids: string[]) {
    await h.ctx.parties.create(ids[0]!)
    const p = await h.ctx.parties.partyOf(ids[0]!)
    for (const id of ids.slice(1)) await h.ctx.parties.join(id, p!.inviteToken)
  }

  it("creates a targeted 1v1 challenge and notifies both players", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const res = await create(a!, { mode: "aim1v1", targetSteamId: b })
    expect(res.status).toBe(201)
    const c = res.body.challenge
    expect(c).toMatchObject({ mode: "aim1v1", status: "open", createdBy: { steamId: a }, target: { steamId: b }, matchId: null })
    expect(res.body.url).toBe(`${h.ctx.env.PUBLIC_URL.replace(/\/$/, "")}/challenge/${c.code}`)
    expect(Date.parse(c.expiresAt) - h.clock.now()).toBe(600_000)
    const upd = h.notifier.ofType("challenge_update")
    expect(upd).toHaveLength(1)
    expect(upd[0]!.audience).toEqual({ kind: "users", steamIds: [a, b] })

    const pub = await call(null, "GET", `/challenges/${c.code}`)
    expect(pub.status).toBe(200)
    expect(pub.body.challenge.id).toBe(c.id)
    expect((await call(null, "GET", `/challenges/${c.code.toLowerCase()}`)).status).toBe(200)
    expect((await call(null, "GET", "/challenges/NOPE2345")).status).toBe(404)

    // Asking twice returns the same open challenge
    const again = await create(a!, { mode: "aim1v1", targetSteamId: b })
    expect(again.body.challenge.id).toBe(c.id)
  })

  it("validates the body and the target", async () => {
    const [a] = await makeUsers(h.db, 1)
    expect((await call(null, "POST", "/challenges", { mode: "aim1v1" })).status).toBe(401)
    expect((await create(a!, { mode: "nope" })).status).toBe(400)
    expect((await create(a!, { mode: "aim1v1", targetSteamId: a })).body.error).toBe("self_challenge")
    expect((await create(a!, { mode: "aim1v1", targetSteamId: "76561198999999999" })).status).toBe(404)
    // Team modes need a full party led by the creator
    expect((await create(a!, { mode: "aim2v2" })).body.error).toBe("party_size")
  })

  it("accept creates a match that skips queue and accept and runs the veto", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    const { challenge } = (await create(a!, { mode: "aim1v1", targetSteamId: b })).body
    expect((await call(c!, "POST", `/challenges/${challenge.code}/accept`)).body.error).toBe("not_target")
    expect((await call(a!, "POST", `/challenges/${challenge.code}/accept`)).body.error).toBe("own_challenge")

    h.notifier.clear()
    const res = await call(b!, "POST", `/challenges/${challenge.code}/accept`)
    expect(res.status).toBe(200)
    const accepted = res.body.challenge
    expect(accepted.status).toBe("accepted")
    expect(accepted.matchId).toBeTruthy()
    const matchId = accepted.matchId!

    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("veto")
    expect(m!.teams).toEqual([
      { name: "A", steamIds: [a] },
      { name: "B", steamIds: [b] },
    ])
    const players = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(players.every((p) => p.accepted && p.ticketId === null)).toBe(true)
    expect(h.notifier.ofType("match_found")).toHaveLength(0)
    expect(h.notifier.ofType("veto_state").length).toBeGreaterThan(0)
    expect(h.notifier.ofType("challenge_update").at(-1)!.msg.payload).toMatchObject({ challenge: { status: "accepted", matchId } })

    const [v] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
    expect((v!.state as VetoState).steps.length).toBeGreaterThan(0)
    await finishVeto(h, matchId)
    const [after] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(after!.status).toBe("starting")
    expect(h.agent.started.map((r) => r.matchId)).toContain(matchId)

    // Answering again fails
    expect((await call(b!, "POST", `/challenges/${challenge.code}/accept`)).body.error).toBe("challenge_accepted")
  })

  it("an open link can be accepted by anyone and records the accepter", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const { challenge } = (await create(a!, { mode: "aim1v1" })).body
    expect(challenge.target).toBeNull()
    const res = await call(b!, "POST", `/challenges/${challenge.code}/accept`)
    expect(res.body.challenge).toMatchObject({ status: "accepted", target: { steamId: b } })
  })

  it("refuses to start when a player is already in a match and pulls queued players out", async () => {
    const [a, b, c, d] = await makeUsers(h.db, 4)
    await h.ctx.flow.createDirectMatch({ mode: "aim1v1", teams: [{ name: "A", steamIds: [c!] }, { name: "B", steamIds: [d!] }] })
    const busy = (await create(a!, { mode: "aim1v1", targetSteamId: c })).body.challenge
    expect((await call(c!, "POST", `/challenges/${busy.code}/accept`)).body.error).toBe("in_match")

    await h.ctx.queue.join(b!, ["aim1v1"])
    const ok = (await create(a!, { mode: "aim1v1", targetSteamId: b })).body.challenge
    expect((await call(b!, "POST", `/challenges/${ok.code}/accept`)).status).toBe(200)
    const tickets = await h.db.select().from(queueTickets)
    expect(tickets.every((t) => t.status === "cancelled" && t.cancelReason === "challenge_accepted")).toBe(true)
  })

  it("target declines, creator withdraws", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    const one = (await create(a!, { mode: "aim1v1", targetSteamId: b })).body.challenge
    expect((await call(c!, "POST", `/challenges/${one.code}/decline`)).status).toBe(403)
    expect((await call(b!, "POST", `/challenges/${one.code}/decline`)).body.challenge.status).toBe("declined")
    expect((await call(b!, "POST", `/challenges/${one.code}/accept`)).body.error).toBe("challenge_declined")

    const two = (await create(a!, { mode: "aim1v1", targetSteamId: c })).body.challenge
    expect((await call(a!, "POST", `/challenges/${two.code}/decline`)).body.challenge.status).toBe("cancelled")
  })

  it("expires after ten minutes from the sweep or on read", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    const one = (await create(a!, { mode: "aim1v1", targetSteamId: b })).body.challenge
    const two = (await create(a!, { mode: "aim1v1", targetSteamId: c })).body.challenge
    h.clock.advance(599_000)
    const svc = new (await import("./service.js")).ChallengeService(h.ctx)
    expect(await svc.expireDue()).toBe(0)
    h.clock.advance(2000)
    h.notifier.clear()
    // Read path expires on its own
    expect((await call(null, "GET", `/challenges/${one.code}`)).body.challenge.status).toBe("expired")
    expect(await svc.expireDue()).toBe(1)
    const [row] = await h.db.select().from(challenges).where(eq(challenges.id, two.id))
    expect(row!.status).toBe("expired")
    expect(h.notifier.ofType("challenge_update")).toHaveLength(2)
    expect((await call(b!, "POST", `/challenges/${one.code}/accept`)).body.error).toBe("challenge_expired")
  })

  it("lists open challenges sent and received", async () => {
    const [a, b, c] = await makeUsers(h.db, 3)
    await create(a!, { mode: "aim1v1", targetSteamId: b })
    await create(c!, { mode: "aim1v1", targetSteamId: a })
    await create(b!, { mode: "aim1v1", targetSteamId: c })
    const res = await call(a!, "GET", "/challenges/mine")
    const list = res.body.challenges as Challenge[]
    expect(list).toHaveLength(2)
    expect(list.every((x) => x.createdBy.steamId === a || x.target?.steamId === a)).toBe(true)
  })

  it("caps open challenges per player", async () => {
    const [a, ...rest] = await makeUsers(h.db, 7)
    for (const t of rest.slice(0, 5)) expect((await create(a!, { mode: "aim1v1", targetSteamId: t })).status).toBe(201)
    expect((await create(a!, { mode: "aim1v1", targetSteamId: rest[5] })).body.error).toBe("too_many_challenges")
  })

  it("challenge matches are unrated but keep their result", async () => {
    const [a, b] = await makeUsers(h.db, 2)
    const matchId = await finishedMatch("aim1v1", [a!], [b!])
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.source).toBe("challenge")
    expect(m!.status).toBe("finished")
    expect(await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))).toHaveLength(0)
    const players = await h.db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
    expect(players.find((p) => p.steamId === a)!.won).toBe(true)
    const result = h.notifier.ofType("match_result").at(-1)!.msg.payload as { ratingChanges: unknown[] }
    expect(result.ratingChanges).toEqual([])
    const page = (await call(null, "GET", `/matches/${matchId}`)).body as unknown as { match: { unrated?: boolean } }
    expect(page.match.unrated).toBe(true)
  })

  describe("rematch", () => {
    it("only a participant of a finished match can ask, and it targets the opponent", async () => {
      const [a, b, c] = await makeUsers(h.db, 3)
      const { matchId: live } = await h.ctx.flow.createDirectMatch({
        mode: "aim1v1",
        teams: [
          { name: "A", steamIds: [a!] },
          { name: "B", steamIds: [b!] },
        ],
      })
      expect((await create(a!, { mode: "aim1v1", rematchOfMatchId: live })).body.error).toBe("match_not_finished")
      await h.ctx.flow.finishMatch(live, { type: "match_end", winnerTeam: "A", score: { A: 16, B: 3 }, players: [], demoUploaded: false })

      expect((await create(c!, { mode: "aim1v1", rematchOfMatchId: live })).body.error).toBe("not_in_match")
      expect((await create(a!, { mode: "aim2v2", rematchOfMatchId: live })).body.error).toBe("mode_mismatch")
      expect((await create(a!, { mode: "aim1v1", rematchOfMatchId: live, targetSteamId: c })).body.error).toBe("target_mismatch")

      const first = (await create(a!, { mode: "aim1v1", rematchOfMatchId: live })).body.challenge
      expect(first).toMatchObject({ rematchOfMatchId: live, target: { steamId: b }, createdBy: { steamId: a } })
      // The loser pressing Rematch too gets the same challenge back
      const second = (await create(b!, { mode: "aim1v1", rematchOfMatchId: live })).body.challenge
      expect(second.id).toBe(first.id)

      const res = await call(b!, "POST", `/challenges/${first.code}/accept`)
      expect(res.body.challenge.status).toBe("accepted")
      expect(res.body.challenge.matchId).not.toBe(live)
    })

    it("team rematch targets the other party leader and needs the same rosters", async () => {
      const [a1, a2, b1, b2, x] = await makeUsers(h.db, 5)
      await party([a1!, a2!])
      await party([b1!, b2!])
      const matchId = await finishedMatch("aim2v2", [a1!, a2!], [b1!, b2!])

      // Only the party leader can ask
      expect((await create(a2!, { mode: "aim2v2", rematchOfMatchId: matchId })).body.error).toBe("not_leader")
      const c = (await create(a1!, { mode: "aim2v2", rematchOfMatchId: matchId })).body.challenge
      expect(c.target?.steamId).toBe(b1)

      // The other side swaps a player, so the rematch cannot start
      await h.ctx.parties.leave(b2!)
      const p = await h.ctx.parties.partyOf(b1!)
      await h.ctx.parties.join(x!, p!.inviteToken)
      expect((await call(b1!, "POST", `/challenges/${c.code}/accept`)).body.error).toBe("roster_changed")

      await h.ctx.parties.leave(x!)
      await h.ctx.parties.join(b2!, p!.inviteToken)
      const ok = await call(b1!, "POST", `/challenges/${c.code}/accept`)
      expect(ok.status).toBe(200)
      const [m] = await h.db.select().from(matches).where(eq(matches.id, ok.body.challenge.matchId!))
      expect(m!.teams.map((t) => [...t.steamIds].sort())).toEqual([[a1, a2].sort(), [b1, b2].sort()])
      // Teammates hear about it too so their pages can follow
      const last = h.notifier.ofType("challenge_update").at(-1)!
      expect(last.audience).toMatchObject({ kind: "users" })
      expect((last.audience as { steamIds: string[] }).steamIds.sort()).toEqual([a1, a2, b1, b2].sort())
    })

    it("fails when the opponents are no longer in one party", async () => {
      const [a1, a2, b1, b2] = await makeUsers(h.db, 4)
      await party([a1!, a2!])
      const matchId = await finishedMatch("aim2v2", [a1!, a2!], [b1!, b2!])
      expect((await create(a1!, { mode: "aim2v2", rematchOfMatchId: matchId })).body.error).toBe("opponents_split")
    })
  })
})
