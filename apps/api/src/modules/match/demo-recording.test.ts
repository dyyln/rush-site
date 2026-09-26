import { DEMO_RECORDING_FLAG, StartServerRequestSchema, type ServerDriver, type StartServerRequest } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createHarness, finishVeto, makeUsers, startDuel, withServers, type Harness } from "../../../test/helpers.js"
import { demos, matches } from "../../db/schema.js"
import { MatchesDathostStore } from "./dathost.js"
import { NO_DEMO_TEARDOWN_SEC } from "./flow.js"

class FakeSurge implements ServerDriver {
  readonly name = "dathost" as const
  started: StartServerRequest[] = []
  stopped: string[] = []
  fetched: string[] = []
  constructor(private readonly store: MatchesDathostStore) {}
  async capacity() {
    return { free: 10, total: 10 }
  }
  async start(req: StartServerRequest) {
    this.started.push(StartServerRequestSchema.parse(req))
    await this.store.set(req.matchId, `clone-${this.started.length}`)
    return { matchId: req.matchId, ip: "1.2.3.4", port: 28015, connect: "connect 1.2.3.4:28015" }
  }
  async stop(matchId: string) {
    this.stopped.push(matchId)
    await this.store.delete(matchId)
  }
  async fetchDemo(matchId: string) {
    this.fetched.push(matchId)
    return Buffer.from("demo")
  }
}

async function row(h: Harness, matchId: string) {
  return (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0]!
}

async function finish(h: Harness, matchId: string, a: string, b: string) {
  await h.ctx.flow.handleEvent(matchId, { type: "server_ready" })
  await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: a })
  await h.ctx.flow.handleEvent(matchId, { type: "player_connected", steamId: b })
  await h.ctx.flow.handleEvent(matchId, { type: "match_started" })
  const players = [a, b].map((steamId) => ({ steamId, kills: 1, deaths: 1, headshots: 0, damage: 100 }))
  await h.ctx.flow.handleEvent(matchId, { type: "match_end", winnerTeam: "A", score: { A: 13, B: 5 }, players, demoUploaded: false })
}

describe("demo recording setting", () => {
  let h: Harness
  afterEach(async () => {
    await h.close()
  })

  it("is off when no row exists and follows the admin toggle without a restart", async () => {
    h = await createHarness()
    expect(await h.ctx.flags.demoRecording()).toBe(false)
    await h.ctx.flags.set(DEMO_RECORDING_FLAG, true, null, "76561198900000001")
    expect(await h.ctx.flags.demoRecording()).toBe(true)
    await h.ctx.flags.set(DEMO_RECORDING_FLAG, false, null, "76561198900000001")
    expect(await h.ctx.flags.demoRecording()).toBe(false)
    // Server side only. The public flag list never shows it
    await h.ctx.flags.set(DEMO_RECORDING_FLAG, true, null, null)
    expect(await h.ctx.flags.publicFlags()).not.toHaveProperty(DEMO_RECORDING_FLAG)
  })

  it("off sends recordDemo false, presigns nothing and stores no demo row", async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
    const presign = vi.spyOn(h.ctx.storage, "presignUpload")
    const { matchId } = await startDuel(h)

    expect(h.agent.started).toHaveLength(1)
    const req = h.agent.started[0]!
    expect(req.recordDemo).toBe(false)
    expect(req).not.toHaveProperty("demoUpload")
    expect(JSON.stringify(req)).not.toContain("presignedPutUrl")
    expect(presign).not.toHaveBeenCalled()
    expect(StartServerRequestSchema.safeParse(req).success).toBe(true)
    expect((await row(h, matchId)).recordDemo).toBe(false)
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(0)
  })

  it("on keeps the request as before, with a presigned upload and no recordDemo field", async () => {
    h = await createHarness({ rng: () => 0, demoRecording: true })
    await withServers(h)
    const { matchId } = await startDuel(h)

    const req = h.agent.started[0]!
    expect(req).not.toHaveProperty("recordDemo")
    expect(req.demoUpload?.key).toContain(`${matchId}.dem`)
    expect(req.demoUpload?.presignedPutUrl).toMatch(/^http/)
    expect((await row(h, matchId)).recordDemo).toBe(true)
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(1)
  })

  it("off leaves the upload list out of a series request", async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    const { matchId } = await h.ctx.flow.createTournamentMatch({
      mode: "aim1v1",
      teams: [
        { name: "A", steamIds: [a] },
        { name: "B", steamIds: [b] },
      ],
      source: { kind: "tournament", tournamentId: crypto.randomUUID(), bracketMatchId: "r3m0", gameNumber: 1, bestOf: 3 },
    })
    await finishVeto(h, matchId)

    // FakeAgent validates like the Go agent, so the request got through its series check
    const req = h.agent.started[0]!
    expect(req.recordDemo).toBe(false)
    expect(req.series).toMatchObject({ bestOf: 3, startMapNumber: 1 })
    expect(req.series).not.toHaveProperty("demoUploads")
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(0)
  })

  it("off releases the server right after the end instead of waiting for an upload", async () => {
    h = await createHarness({ rng: () => 0 })
    await withServers(h)
    const { matchId, a, b } = await startDuel(h)
    await finish(h, matchId, a, b)
    expect((await row(h, matchId)).status).toBe("finished")
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(0)

    await h.ctx.flow.allocationTick()
    expect(h.agent.stopped).not.toContain(matchId)
    h.clock.advance((NO_DEMO_TEARDOWN_SEC + 1) * 1000)
    await h.ctx.flow.allocationTick()
    expect(h.agent.stopped).toContain(matchId)
    expect((await row(h, matchId)).serverReleasedAt).not.toBeNull()
  })

  it("on still holds the server for the demo upload", async () => {
    h = await createHarness({ rng: () => 0, demoRecording: true })
    await withServers(h)
    const { matchId, a, b } = await startDuel(h)
    await finish(h, matchId, a, b)
    h.clock.advance((NO_DEMO_TEARDOWN_SEC + 1) * 1000)
    await h.ctx.flow.allocationTick()
    expect(h.agent.stopped).not.toContain(matchId)
    expect(await h.db.select().from(demos).where(eq(demos.matchId, matchId))).toHaveLength(1)
  })

  it("off on DatHost sends recordDemo false and fetches no demo at teardown", async () => {
    h = await createHarness({ rng: () => 0, env: { AGENT_URLS: "" } })
    const surge = new FakeSurge(new MatchesDathostStore(h.db))
    h.ctx.allocator.setSurgeDriver(surge)
    const { matchId, a, b } = await startDuel(h)

    expect((await row(h, matchId)).driver).toBe("dathost")
    expect(surge.started[0]!.recordDemo).toBe(false)
    expect(surge.started[0]).not.toHaveProperty("demoUpload")

    await finish(h, matchId, a, b)
    h.clock.advance((NO_DEMO_TEARDOWN_SEC + 1) * 1000)
    await h.ctx.flow.allocationTick()
    expect(surge.stopped).toContain(matchId)
    expect(surge.fetched).toHaveLength(0)
  })
})
