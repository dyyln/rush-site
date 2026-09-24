import { EventEmitter } from "node:events"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { matchmakeAll } from "../queue/loop.js"
import { LocalHub } from "./hub.js"
import { attachSocket } from "./routes.js"

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
  // What the client sends over the wire
  say(msg: unknown) {
    this.emit("message", Buffer.from(JSON.stringify({ ts: Date.now(), ...(msg as object) })))
  }
}

const settle = () => new Promise((r) => setTimeout(r, 10))

// A page that mounts on an already open socket sends resync to get the connect replay again
describe("ws resync", () => {
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
    // The connect replay is async so wait for it before clearing
    await vi.waitFor(() => expect(s.types()).toContain("queue_status"))
    await settle()
    return s
  }

  it("replays party and queue state on the same socket", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const s = await connect(a)
    expect(s.types()).toEqual(["party_update", "queue_status"])
    s.received.length = 0

    s.say({ type: "resync", payload: {} })
    await settle()
    expect(s.types()).toEqual(["party_update", "queue_status"])
  })

  it("replays the current queue state after it changed", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    await connect(a)
    await h.ctx.queue.join(a, ["aim1v1"])
    await settle()

    const late = await connect(a)
    late.received.length = 0
    late.say({ type: "resync", payload: {} })
    await settle()
    expect(late.received.find((m) => m.type === "queue_status")!.payload).toMatchObject({ state: "queued" })
  })

  it("replays a pending match so a new page can show the accept step", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const s = await connect(a)
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    await settle()
    s.received.length = 0

    s.say({ type: "resync", payload: {} })
    await settle()
    expect(s.types()).toEqual(["party_update", "queue_status", "match_found"])
    expect(s.received[2]!.payload.matchId).toBe(matchId)
  })

  it("stamps the replay with a fresh ts", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const s = await connect(a)
    s.received.length = 0
    const before = Date.now()
    s.say({ type: "resync", payload: {} })
    await settle()
    expect(s.received.length).toBeGreaterThan(0)
    expect(s.received.every((m) => m.ts >= before)).toBe(true)
  })

  it("only answers the socket that asked", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const one = await connect(a)
    const two = await connect(a)
    one.received.length = 0
    two.received.length = 0
    one.say({ type: "resync", payload: {} })
    await settle()
    expect(one.types()).toEqual(["party_update", "queue_status"])
    expect(two.received).toEqual([])
  })

  it("rejects a resync with a bad payload", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const s = await connect(a)
    s.received.length = 0
    s.say({ type: "resync" })
    await settle()
    expect(s.types()).toEqual(["error"])
    expect(s.received[0]!.payload.code).toBe("invalid_message")
  })
})
