import { EventEmitter } from "node:events"
import pino from "pino"
import { afterEach, describe, expect, it } from "vitest"
import type { AppContext } from "../../context.js"
import { LocalHub, MAX_TOURNAMENT_SUBSCRIPTIONS } from "../ws/hub.js"
import { attachSocket } from "../ws/routes.js"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  received: { type: string; payload: any }[] = []
  send(data: string) {
    this.received.push(JSON.parse(data))
  }
  ping() {}
  terminate() {}
  close() {}
  message(obj: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(obj)))
  }
  of(type: string) {
    return this.received.filter((m) => m.type === type)
  }
}

const T1 = "11111111-1111-4111-8111-111111111111"
const T2 = "22222222-2222-4222-8222-222222222222"
const update = (tournamentId: string) => ({ type: "tournament_update", payload: { tournamentId }, ts: 1 })

describe("tournament subscriptions", () => {
  const hub = new LocalHub()
  const sockets: FakeSocket[] = []
  // Spectator sockets never touch the context.
  const spectator = () => {
    const s = new FakeSocket()
    attachSocket({} as AppContext, hub, s as never, null, pino({ level: "silent" }))
    sockets.push(s)
    return s
  }
  const sub = (s: FakeSocket, type: string, tournamentId: string) =>
    s.message({ type, payload: { tournamentId }, ts: Date.now() })

  afterEach(() => {
    for (const s of sockets.splice(0)) s.emit("close")
  })

  it("delivers tournament audiences to subscribers only", () => {
    const watcher = spectator()
    const other = spectator()
    const leaver = spectator()
    sub(watcher, "subscribe_tournament", T1)
    sub(other, "subscribe_tournament", T2)
    sub(leaver, "subscribe_tournament", T1)
    sub(leaver, "unsubscribe_tournament", T1)

    hub.deliver({ kind: "tournament", tournamentId: T1 }, update(T1))
    expect(watcher.of("tournament_update")).toHaveLength(1)
    expect(other.of("tournament_update")).toHaveLength(0)
    expect(leaver.of("tournament_update")).toHaveLength(0)

    hub.deliver({ kind: "broadcast" }, update(T2))
    for (const s of [watcher, other, leaver]) expect(s.of("tournament_update").at(-1)?.payload.tournamentId).toBe(T2)
  })

  it("drops subscriptions when the socket closes", () => {
    const s = spectator()
    sub(s, "subscribe_tournament", T1)
    s.emit("close")
    hub.deliver({ kind: "tournament", tournamentId: T1 }, update(T1))
    expect(s.of("tournament_update")).toHaveLength(0)
  })

  it("caps subscriptions and rejects bad ids", () => {
    const s = spectator()
    for (let i = 0; i <= MAX_TOURNAMENT_SUBSCRIPTIONS; i++) {
      sub(s, "subscribe_tournament", `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    }
    expect(s.of("error").map((e) => e.payload.code)).toEqual(["too_many_subscriptions"])
    sub(s, "subscribe_tournament", "nope")
    expect(s.of("error").at(-1)?.payload.code).toBe("invalid_message")
  })
})
