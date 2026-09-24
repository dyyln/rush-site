import type { MatchEvent, ServerDriver, ServerLiveness, StartServerRequest } from "@rushsite/shared"
import { eq, inArray } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, finishVeto, makeUsers, startDuel, withServers, type Harness } from "../../../test/helpers.js"
import { cooldowns, gsltTokens, matches, ratingEvents, serverSlots } from "../../db/schema.js"
import { withLease, withLock } from "../../lib/redis.js"
import { matchmakeAll } from "../queue/loop.js"
import { MatchesDathostStore } from "./dathost.js"
import type { MatchResultEvent } from "./flow.js"

const MIN = 60_000

// DatHost stand-in. onStart runs inside start() like a plugin that boots before the API hears back
class FakeSurge implements ServerDriver {
  readonly name = "dathost" as const
  started: StartServerRequest[] = []
  stopped: string[] = []
  liveness: ServerLiveness = "alive"
  onStart: ((req: StartServerRequest) => Promise<void>) | null = null
  constructor(private readonly store: MatchesDathostStore) {}
  async capacity() {
    return { free: 10, total: 10 }
  }
  async start(req: StartServerRequest) {
    this.started.push(req)
    await this.store.set(req.matchId, `clone-${this.started.length}`)
    if (this.onStart) await this.onStart(req)
    return { matchId: req.matchId, ip: "1.2.3.4", port: 28015, connect: "connect 1.2.3.4:28015" }
  }
  async stop(matchId: string) {
    this.stopped.push(matchId)
    await this.store.delete(matchId)
  }
  async status(): Promise<ServerLiveness> {
    return this.liveness
  }
}

async function row(h: Harness, matchId: string) {
  return (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!
}

async function goLive(h: Harness, matchId: string, connected: string[]): Promise<void> {
  await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
  for (const s of connected) await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: s })
  await h.ctx.flow.handleEvent(matchId, { type: "match_started" })
}

describe("match watchdog on Hetzner", () => {
  let h: Harness
  let results: MatchResultEvent[]
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
    results = []
    h.ctx.flow.onResult(async (r) => {
      results.push(r)
    })
  })
  afterEach(async () => {
    await h.close()
  })

  it("ends a live match whose server left GET /servers and lets everyone queue again", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    expect((await row(h, matchId)).status).toBe("live")
    await expect(h.ctx.queue.join(a, ["aim1v1"])).rejects.toMatchObject({ code: "in_match" })

    h.agent.lose(matchId)
    await h.ctx.flow.allocationTick()

    const m = await row(h, matchId)
    expect(m).toMatchObject({ status: "abandoned", cancelReason: "server_lost", ratingApplied: false, winnerTeam: null })
    expect(m.serverReleasedAt).not.toBeNull()
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
    expect(await h.db.select().from(serverSlots).where(eq(serverSlots.matchId, matchId))).toHaveLength(0)
    expect(await h.db.select().from(gsltTokens).where(eq(gsltTokens.matchId, matchId))).toHaveLength(0)
    expect(h.notifier.ofType("match_cancelled").at(-1)!.msg.payload).toEqual({ matchId, reason: "server_lost" })
    expect(results).toEqual([{ matchId, outcome: "abandoned", reason: "server_lost", missingSteamIds: [] }])

    // Queue and party are open again and the pair can be matched straight away
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
    const [next] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    expect(next).toBeDefined()
    expect(next).not.toBe(matchId)
    const [c] = await makeUsers(h.db, 1)
    const party = await h.ctx.parties.create(c!)
    await h.ctx.flow.cancelMatch(next!, "test", { requeue: false })
    const joined = await h.ctx.parties.join(a, party.inviteToken)
    expect(joined.memberSteamIds).toContain(a)
  })

  it("also catches ready and starting matches with no server", async () => {
    const first = await startDuel(h)
    const second = await startDuel(h)
    await h.ctx.flow.handleEvent(second.matchId, { type: "server_ready" })
    expect((await row(h, first.matchId)).status).toBe("starting")
    expect((await row(h, second.matchId)).status).toBe("ready")
    h.agent.lose(first.matchId)
    h.agent.lose(second.matchId)
    await h.ctx.flow.allocationTick()
    expect((await row(h, first.matchId)).cancelReason).toBe("server_lost")
    expect((await row(h, second.matchId)).cancelReason).toBe("server_lost")
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
  })

  it("leaves a running server alone and checks at most once per interval", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    await h.ctx.flow.allocationTick()
    expect(h.agent.listCalls).toBe(1)
    h.clock.advance(10_000)
    h.agent.lose(matchId)
    await h.ctx.flow.allocationTick()
    expect(h.agent.listCalls).toBe(1)
    expect((await row(h, matchId)).status).toBe("live")
    h.clock.advance(21_000)
    await h.ctx.flow.allocationTick()
    expect((await row(h, matchId)).status).toBe("abandoned")
  })

  it("ends a match that runs past the mode cap and stops its server", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    h.clock.advance(59 * MIN)
    await h.ctx.flow.allocationTick()
    expect((await row(h, matchId)).status).toBe("live")
    h.clock.advance(2 * MIN)
    await h.ctx.flow.allocationTick()
    const m = await row(h, matchId)
    expect(m).toMatchObject({ status: "abandoned", cancelReason: "timeout" })
    expect(h.agent.stopped).toContain(matchId)
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
    await h.ctx.queue.join(a, ["aim1v1"])
  })

  it("does not end a match when the agent cannot answer, until webhooks stop too", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    h.agent.listFailsWith = new Error("agent unreachable")
    h.clock.advance(10 * MIN)
    await h.ctx.flow.handleEvent(matchId, { type: "round_end", round: 1, winnerTeam: "A", score: { A: 1, B: 0 } } as MatchEvent)
    h.clock.advance(10 * MIN)
    await h.ctx.flow.allocationTick()
    expect((await row(h, matchId)).status).toBe("live")
    h.clock.advance(6 * MIN)
    await h.ctx.flow.allocationTick()
    expect((await row(h, matchId)).cancelReason).toBe("server_lost")
  })

  it("boot recovery ends matches whose server died while the API was down", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    await h.ctx.flow.allocationTick()
    // The box rebooted and the agent's Recover skipped the dead process
    h.agent.lose(matchId)
    h.clock.advance(5_000)
    expect(await h.ctx.flow.recover()).toEqual([matchId])
    expect((await row(h, matchId)).cancelReason).toBe("server_lost")
    await h.ctx.queue.join(a, ["aim1v1"])
  })

  it("a late match_end after a watchdog end changes nothing", async () => {
    const { matchId, a, b } = await startDuel(h)
    await goLive(h, matchId, [a, b])
    h.agent.lose(matchId)
    await h.ctx.flow.allocationTick()
    await h.ctx.flow.handleEvent(matchId, { type: "match_end", winnerTeam: "A", score: { A: 16, B: 3 }, players: [], demoUploaded: false })
    expect((await row(h, matchId)).status).toBe("abandoned")
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
  })
})

describe("match watchdog on DatHost", () => {
  let h: Harness
  let surge: FakeSurge
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0, env: { AGENT_URLS: "", SURGE_WAIT_SEC: "0" } })
    surge = new FakeSurge(new MatchesDathostStore(h.db))
    h.ctx.allocator.setSurgeDriver(surge)
    await h.ctx.allocator.seedGslt(["tok1", "tok2"])
  })
  afterEach(async () => {
    await h.close()
  })

  async function rushCup(): Promise<{ matchId: string; players: string[] }> {
    const players = await makeUsers(h.db, 6)
    const { matchId } = await h.ctx.flow.createTournamentMatch({
      mode: "rush3v3",
      teams: [
        { name: "A", steamIds: players.slice(0, 3) },
        { name: "B", steamIds: players.slice(3) },
      ],
      source: { kind: "tournament", tournamentId: crypto.randomUUID(), bracketMatchId: "r1m1", gameNumber: 1, bestOf: 1 },
    })
    return { matchId, players }
  }

  it("ends a match whose clone the driver reports gone and deletes it", async () => {
    const { matchId, players } = await rushCup()
    await goLive(h, matchId, players)
    surge.liveness = "gone"
    await h.ctx.flow.allocationTick()
    expect((await row(h, matchId)).cancelReason).toBe("server_lost")
    expect(surge.stopped).toContain(matchId)
    expect(await h.db.select().from(gsltTokens).where(eq(gsltTokens.matchId, matchId))).toHaveLength(0)
  })

  it("server_ready during the DatHost boot is held until connect info exists", async () => {
    const ready: string[] = []
    surge.onStart = async (req) => {
      await h.ctx.flow.handleEvent(req.matchId, { type: "server_ready" })
      const m = await row(h, req.matchId)
      ready.push(m.status)
    }
    const { matchId, players } = await rushCup()
    // The early server_ready did not move the match or reach anyone
    expect(ready).toEqual(["allocating"])
    const m = await row(h, matchId)
    expect(m).toMatchObject({ status: "ready", serverIp: "1.2.3.4", serverPort: 28015 })
    expect(m.connect).toContain(`password ${m.password}`)
    const sent = h.notifier.ofType("server_ready")
    expect(sent).toHaveLength(1)
    expect(sent[0]!.audience.kind === "users" && [...sent[0]!.audience.steamIds].sort()).toEqual([...players].sort())
    expect(sent[0]!.msg.payload).toMatchObject({ matchId, ip: "1.2.3.4", port: 28015 })

    // Even when nobody makes it in, nobody is punished for our failure
    h.clock.advance(601_000)
    await h.ctx.flow.tick()
    expect((await row(h, matchId)).cancelReason).toBe("server_unreachable")
    expect(await h.db.select().from(cooldowns).where(inArray(cooldowns.steamId, players))).toHaveLength(0)
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
  })

  it("connect info lands on a match that already reached ready", async () => {
    let matchId = ""
    surge.onStart = async (req) => {
      matchId = req.matchId
      await h.db.update(matches).set({ status: "ready", readyAt: new Date(h.clock.now()) }).where(eq(matches.id, req.matchId))
    }
    await rushCup()
    const m = await row(h, matchId)
    expect(m).toMatchObject({ status: "ready", serverIp: "1.2.3.4" })
    expect(h.notifier.ofType("server_ready")).toHaveLength(1)
  })

  it("stops the clone when the match ended while it booted", async () => {
    surge.onStart = async (req) => {
      await h.db.update(matches).set({ status: "cancelled" }).where(eq(matches.id, req.matchId))
    }
    const { matchId } = await rushCup()
    expect(surge.stopped).toContain(matchId)
    expect((await row(h, matchId)).serverIp).toBeNull()
  })

  it("a second allocation pass during a long boot does not start a second clone", async () => {
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    let matchId = ""
    surge.onStart = async (req) => {
      matchId = req.matchId
      await gate
    }
    const first = rushCup()
    for (let i = 0; i < 100 && !matchId; i++) await new Promise((r) => setTimeout(r, 5))
    h.clock.advance(5 * MIN)
    await h.ctx.flow.tryAllocate(matchId)
    await h.ctx.flow.allocationTick()
    expect(surge.started).toHaveLength(1)
    open()
    await first
    expect((await row(h, matchId)).status).toBe("starting")
  })
})

describe("withLease", () => {
  it("keeps the key while the holder is still working", async () => {
    const h = await createHarness()
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let second: string | undefined = "not run"
    await withLease(h.redis, "lock:test", 40, async () => {
      await wait(150)
      second = await withLock(h.redis, "lock:test", 40, async () => "ran")
    })
    expect(second).toBeUndefined()
    expect(await h.redis.get("lock:test")).toBeNull()
    await h.close()
  })
})

describe("no-show penalties", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
  })
  afterEach(async () => {
    await h.close()
  })

  it("nobody connecting is our failure: no cooldowns and no rating", async () => {
    const { matchId, a, b } = await startDuel(h)
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    h.clock.advance(601_000)
    await h.ctx.flow.timersTick()
    const m = await row(h, matchId)
    expect(m).toMatchObject({ cancelReason: "server_unreachable", ratingApplied: false, winnerTeam: null })
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
  })

  it("a no-show reported by the plugin while the winner never connected is unrated and unpunished", async () => {
    const { matchId, b } = await startDuel(h)
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    await h.ctx.flow.handleEvent(matchId, { type: "match_abandoned", reason: "no_show", missingSteamIds: [b] })
    const m = await row(h, matchId)
    expect(m).toMatchObject({ ratingApplied: false, winnerTeam: null, cancelReason: "server_unreachable" })
    expect(await h.db.select().from(cooldowns)).toHaveLength(0)
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
  })

  async function duo(): Promise<{ matchId: string; a: string[]; b: string[] }> {
    const players = await makeUsers(h.db, 4)
    const a = players.slice(0, 2)
    const b = players.slice(2)
    // Queue parties so the match is rated like a ladder game
    const pa = await h.ctx.parties.create(a[0]!)
    await h.ctx.parties.join(a[1]!, pa.inviteToken)
    const pb = await h.ctx.parties.create(b[0]!)
    await h.ctx.parties.join(b[1]!, pb.inviteToken)
    await h.ctx.queue.join(a[0]!, ["aim2v2"])
    await h.ctx.queue.join(b[0]!, ["aim2v2"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    for (const s of players) await h.ctx.flow.respond(s, matchId!, true)
    await finishVeto(h, matchId!)
    const m = await row(h, matchId!)
    return { matchId: matchId!, a: m.teams[0]!.steamIds, b: m.teams[1]!.steamIds }
  }

  it("a forfeit rates only winners who connected and punishes the missing side", async () => {
    const { matchId, a, b } = await duo()
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: a[1]! })
    await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: b[0]! })
    await h.ctx.flow.handleEvent(matchId, { type: "match_abandoned", reason: "no_show", missingSteamIds: [a[0]!] })
    const m = await row(h, matchId)
    expect(m).toMatchObject({ status: "abandoned", winnerTeam: "B", ratingApplied: true })
    const ev = await h.db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))
    expect(ev.map((e) => e.steamId).sort()).toEqual([a[0]!, b[0]!].sort())
    expect(ev.find((e) => e.steamId === a[0])!.reason).toBe("forfeit")
    const cds = await h.db.select().from(cooldowns)
    expect(cds.map((c) => [c.steamId, c.reason])).toEqual([[a[0], "no_connect"]])
  })

  it("missing players on both sides are unrated and only punished when the other side got in", async () => {
    const { matchId, a, b } = await duo()
    await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
    await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: a[0]! })
    h.clock.advance(601_000)
    await h.ctx.flow.timersTick()
    const m = await row(h, matchId)
    expect(m).toMatchObject({ ratingApplied: false, winnerTeam: null, cancelReason: "connect_timeout" })
    expect(await h.db.select().from(ratingEvents)).toHaveLength(0)
    // Team A reached the server, so team B's no-shows are real. A's teammate faced an empty team
    const cds = await h.db.select().from(cooldowns)
    expect(cds.map((c) => c.steamId).sort()).toEqual([...b].sort())
  })
})
