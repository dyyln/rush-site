import { describe, expect, it } from "vitest"
import { LocalHub } from "../modules/ws/hub.js"
import { CLOSE_TRY_AGAIN_LATER, HARD_BUFFER_LIMIT, SOFT_BUFFER_LIMIT, realtimeMetrics, sendChecked } from "./backpressure.js"

class FakeSocket {
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  closedWith: number | null = null
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number) {
    this.closedWith = code ?? null
    this.readyState = 2
  }
}

const msg = (type: string) => ({ type, payload: {}, ts: 1 })

describe("back-pressure", () => {
  it("sends everything while the buffer is small", () => {
    const s = new FakeSocket()
    s.bufferedAmount = SOFT_BUFFER_LIMIT
    expect(sendChecked(s, msg("mode_stats"), "x")).toBe(true)
    expect(sendChecked(s, msg("match_found"), "x")).toBe(true)
    expect(s.sent).toHaveLength(2)
  })

  it("drops mode_stats and queue_status refreshes above 256 KB but keeps match messages", () => {
    const s = new FakeSocket()
    s.bufferedAmount = SOFT_BUFFER_LIMIT + 1
    const before = realtimeMetrics.droppedSlow
    expect(sendChecked(s, msg("mode_stats"), "x")).toBe(false)
    expect(sendChecked(s, { type: "queue_status", payload: { refresh: true } }, "x")).toBe(false)
    // A queue state change is never dropped
    expect(sendChecked(s, { type: "queue_status", payload: { state: "idle" } }, "x")).toBe(true)
    expect(sendChecked(s, msg("match_found"), "x")).toBe(true)
    expect(s.sent).toHaveLength(2)
    expect(realtimeMetrics.droppedSlow - before).toBe(2)
    expect(s.closedWith).toBeNull()
  })

  it("closes the socket with 1013 above 1 MB", () => {
    const s = new FakeSocket()
    s.bufferedAmount = HARD_BUFFER_LIMIT + 1
    const before = realtimeMetrics.closedSlow
    expect(sendChecked(s, msg("match_found"), "x")).toBe(false)
    expect(s.closedWith).toBe(CLOSE_TRY_AGAIN_LATER)
    expect(s.sent).toHaveLength(0)
    expect(realtimeMetrics.closedSlow - before).toBe(1)
    // Closing sockets get nothing more and are not counted twice
    expect(sendChecked(s, msg("match_found"), "x")).toBe(false)
    expect(realtimeMetrics.closedSlow - before).toBe(1)
  })

  it("applies per socket in hub fan-out", () => {
    const hub = new LocalHub()
    const fast = new FakeSocket()
    const slow = new FakeSocket()
    slow.bufferedAmount = SOFT_BUFFER_LIMIT * 2
    hub.add("a", fast)
    hub.add("b", slow)
    hub.deliver({ kind: "broadcast" }, msg("mode_stats"))
    hub.deliver({ kind: "users", steamIds: ["a", "b"] }, msg("server_ready"))
    expect(fast.sent).toHaveLength(2)
    expect(slow.sent.map((d) => JSON.parse(d).type)).toEqual(["server_ready"])
  })
})
