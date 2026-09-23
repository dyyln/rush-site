import { EventEmitter } from "node:events"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../test/helpers.js"
import { matchmakeAll } from "../modules/queue/loop.js"
import { LocalHub } from "../modules/ws/hub.js"
import { attachSocket } from "../modules/ws/routes.js"
import { snapshotKey } from "./snapshots.js"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  received: { type: string; payload: any; ts: number }[] = []
  send(data: string) {
    this.received.push(JSON.parse(data))
  }
  ping() {}
  terminate() {}
  close() {
    this.readyState = 3
  }
  types() {
    return this.received.map((m) => m.type)
  }
}

const settle = () => new Promise((r) => setTimeout(r, 10))

describe("reconnect snapshot", () => {
  let h: Harness
  let hub: LocalHub
  const sockets: FakeSocket[] = []

  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
    hub = new LocalHub()
  })
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.emit("close")
    vi.restoreAllMocks()
    await h.close()
  })

  async function connect(steamId: string): Promise<FakeSocket> {
    const s = new FakeSocket()
    sockets.push(s)
    attachSocket(h.ctx, hub, s, steamId, pino({ level: "silent" }))
    await settle()
    return s
  }

  function spyDb() {
    return [
      vi.spyOn(h.ctx.parties, "partyOf"),
      vi.spyOn(h.ctx.parties, "payload"),
      vi.spyOn(h.ctx.queue, "status"),
      vi.spyOn(h.ctx.flow, "resendState"),
    ]
  }

  it("round trips an update", async () => {
    const party = { type: "party_update", payload: { partyId: null, leaderSteamId: null, members: [], inviteCode: null }, ts: 1 }
    const queue = { type: "queue_status", payload: { state: "idle", partyId: null, modes: [], cooldownUntil: null }, ts: 2 }
    await h.ctx.snapshots.update("s1", { party, queue })
    expect(await h.ctx.snapshots.read("s1")).toBeNull()
    await h.ctx.snapshots.update("s1", { match: null })
    expect(await h.ctx.snapshots.read("s1")).toEqual({ party, queue, match: null })
    expect(await h.redis.pttl(snapshotKey("s1"))).toBeGreaterThan(0)
  })

  it("falls back to Postgres once, then serves from Redis with no queries", async () => {
    const [a] = await makeUsers(h.db, 1)
    const first = spyDb()
    const s1 = await connect(a!)
    expect(s1.types()).toEqual(["party_update", "queue_status"])
    expect(first[0]).toHaveBeenCalled()
    vi.restoreAllMocks()

    const spies = spyDb()
    const s2 = await connect(a!)
    expect(s2.types()).toEqual(["party_update", "queue_status"])
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  it("tracks queue and match messages as they are sent", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await connect(a)
    await connect(b)
    await h.ctx.queue.join(a, ["aim1v1"])
    await settle()
    let snap = await h.ctx.snapshots.read(a)
    expect(snap!.queue.payload).toMatchObject({ state: "queued" })

    await h.ctx.queue.join(b, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    await settle()

    const spies = spyDb()
    const s = await connect(a)
    for (const sp of spies) expect(sp).not.toHaveBeenCalled()
    expect(s.types()).toEqual(["party_update", "queue_status", "match_found"])
    // Claiming a ticket sends no queue_status, so the snapshot must not claim the player is still queued
    expect(s.received[1]!.payload.state).toBe("idle")
    expect(s.received[2]!.payload.matchId).toBe(matchId)

    await h.ctx.flow.respond(a, matchId!, true)
    await h.ctx.flow.respond(b, matchId!, true)
    await settle()
    snap = await h.ctx.snapshots.read(a)
    expect(snap!.match!.type).toBe("veto_state")

    await h.ctx.flow.cancelMatch(matchId!, "admin", { requeue: false })
    await settle()
    snap = await h.ctx.snapshots.read(a)
    expect(snap!.match).toBeNull()
  })

  it("skips refreshes and stamps the replay with a fresh ts", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    await connect(a)
    const stored = (await h.ctx.snapshots.read(a))!.queue
    h.ctx.notifier.send(
      { kind: "users", steamIds: [a] },
      { type: "queue_status", payload: { ...(stored.payload as object), refresh: true }, ts: stored.ts + 1 },
    )
    await settle()
    expect((await h.ctx.snapshots.read(a))!.queue).toEqual(stored)

    const before = Date.now()
    const s = await connect(a)
    expect(s.received.every((m) => m.ts >= before)).toBe(true)
    expect(stored.ts).toBeLessThan(before)
  })

  it("serves an expired cooldown as idle", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    await connect(a)
    const cd = await h.ctx.cooldowns.issue(a, "decline", null)
    await h.ctx.queue.notifyParty([a])
    await settle()
    expect((await h.ctx.snapshots.read(a))!.queue.payload).toMatchObject({ state: "cooldown" })
    h.clock.advance(cd.endsAt - h.clock.now() + 1)
    expect((await h.ctx.snapshots.read(a))!.queue.payload).toMatchObject({ state: "idle", cooldownUntil: null })
  })
})
