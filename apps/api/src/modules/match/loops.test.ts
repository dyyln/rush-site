import { randomUUID } from "node:crypto"
import { createVeto, getModeConfig, type StartServerRequest, type StartServerResponse, type VetoState } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createHarness, makeUsers, withServers, type Harness } from "../../../test/helpers.js"
import { matches, vetoes } from "../../db/schema.js"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("split match tick", () => {
  let h: Harness
  let release: () => void
  let inFlight = 0
  let maxInFlight = 0
  let calls = 0

  beforeEach(async () => {
    h = await createHarness({ rng: () => 0, env: { GSLT_TOKENS: "GSLTTOKEN0001,GSLTTOKEN0002,GSLTTOKEN0003,GSLTTOKEN0004,GSLTTOKEN0005,GSLTTOKEN0006,GSLTTOKEN0007,GSLTTOKEN0008" } })
    h.agent.health_ = { ...h.agent.health_, slots: { total: 8, free: 8 } }
    await withServers(h)
    inFlight = 0
    maxInFlight = 0
    calls = 0
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    release = open
    const original = h.agent.start.bind(h.agent)
    // A host that hangs until the test lets it answer
    h.agent.start = async (url: string, req: StartServerRequest): Promise<StartServerResponse> => {
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await gate
      inFlight--
      return original(url, req)
    }
  })
  afterEach(async () => {
    release()
    await h.close()
  })

  async function insertMatch(status: "allocating" | "veto"): Promise<{ id: string; a: string; b: string }> {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const id = randomUUID()
    await h.db.insert(matches).values({
      id,
      mode: "aim1v1",
      status,
      source: "challenge",
      teams: [
        { name: "A", steamIds: [a] },
        { name: "B", steamIds: [b] },
      ],
      mapId: "aim_map",
      maps: ["aim_map"],
      webhookSecret: "secret",
      password: "pw1234",
      allocationStartedAt: new Date(h.clock.now()),
      createdAt: new Date(h.clock.now()),
    })
    return { id, a, b }
  }

  async function allocating(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await insertMatch("allocating")
  }

  async function wait4(n: number): Promise<void> {
    for (let i = 0; i < 200 && inFlight < n; i++) await wait(10)
  }

  it("resolves a veto deadline while the allocation loop waits on a slow agent", async () => {
    await allocating(2)
    let allocDone = false
    const alloc = h.ctx.flow.allocationTick().then(() => {
      allocDone = true
    })
    await wait4(2)
    expect(inFlight).toBe(2)

    const v = await insertMatch("veto")
    const cfg = getModeConfig("aim1v1")
    const state = createVeto({
      pool: cfg.maps.map((x) => x.id),
      teams: [
        { id: "A", steamIds: [v.a] },
        { id: "B", steamIds: [v.b] },
      ],
      format: cfg.vetoFormat,
      firstTeam: 0,
    })
    await h.db.insert(vetoes).values({ matchId: v.id, format: "bo1", state, stepDeadline: new Date(h.clock.now() - 1000) })
    await h.ctx.flow.timersTick()
    const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, v.id))
    expect((row!.state as VetoState).stepIndex).toBe(1)
    expect(allocDone).toBe(false)

    release()
    await alloc
    expect(inFlight).toBe(0)
  })

  it("never runs more than four agent calls at once", async () => {
    await allocating(7)
    const alloc = h.ctx.flow.allocationTick(4)
    await wait4(4)
    await wait(30)
    expect(inFlight).toBe(4)
    release()
    await alloc
    expect(maxInFlight).toBe(4)
    expect(calls).toBe(7)
    const rows = await h.db.select().from(matches)
    expect(rows.every((r) => r.status === "starting")).toBe(true)
  })

  it("leaves server starts out of the timers loop", async () => {
    await allocating(1)
    await h.ctx.flow.timersTick()
    expect(calls).toBe(0)
  })
})
