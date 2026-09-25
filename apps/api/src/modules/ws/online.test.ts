import { EventEmitter } from "node:events"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, type Harness } from "../../../test/helpers.js"
import { LocalHub } from "./hub.js"
import { countOnline, ONLINE_WINDOW_MS, touchOnline } from "./online.js"
import { attachSocket } from "./routes.js"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  send() {}
  ping() {}
  terminate() {}
}

const settle = () => new Promise((r) => setTimeout(r, 20))

// Players online counts each Steam ID once, however many tabs are open
describe("online players", () => {
  let h: Harness
  let hub: LocalHub
  const sockets: FakeSocket[] = []

  beforeEach(async () => {
    h = await createHarness()
    hub = new LocalHub()
  })
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.emit("close")
    await h.close()
  })

  function connect(steamId: string): FakeSocket {
    const s = new FakeSocket()
    sockets.push(s)
    attachSocket(h.ctx, hub, s, steamId, pino({ level: "silent" }))
    return s
  }

  it("counts several tabs of one player once", async () => {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    connect(a)
    const second = connect(a)
    connect(b)
    await settle()
    expect(hub.connectedSockets()).toBe(3)
    expect(await countOnline(h.ctx.redis, h.ctx.now())).toBe(2)

    // Closing one of two tabs keeps the player online
    second.emit("close")
    await settle()
    expect(await countOnline(h.ctx.redis, h.ctx.now())).toBe(2)
  })

  it("drops a player when their last tab closes", async () => {
    const [a] = (await makeUsers(h.db, 1)) as [string]
    const s = connect(a)
    await settle()
    expect(await countOnline(h.ctx.redis, h.ctx.now())).toBe(1)
    sockets.splice(sockets.indexOf(s), 1)
    s.emit("close")
    await settle()
    expect(await countOnline(h.ctx.redis, h.ctx.now())).toBe(0)
  })

  it("forgets a player with no heartbeat inside the window", async () => {
    const now = h.ctx.now()
    await touchOnline(h.ctx.redis, "76561190000000001", now - ONLINE_WINDOW_MS - 1)
    await touchOnline(h.ctx.redis, "76561190000000002", now - 1000)
    expect(await countOnline(h.ctx.redis, now)).toBe(1)
  })
})
