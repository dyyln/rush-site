import { BRAND_NAME, MODE_CONFIGS, MODES, resolveLaunch, StartServerRequestSchema, type ServerDriver, type StartServerRequest } from "@rushsite/shared"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { validateLikeAgent } from "../../../test/agent-contract.js"
import { createHarness, finishVeto, makeUsers, type Harness } from "../../../test/helpers.js"
import { gsltTokens, matches, serverSlots } from "../../db/schema.js"
import { matchmakeAll } from "../queue/loop.js"
import { MatchesDathostStore } from "./dathost.js"

class FakeSurge implements ServerDriver {
  readonly name = "dathost" as const
  started: StartServerRequest[] = []
  stopped: string[] = []
  demos: string[] = []
  constructor(private readonly store: MatchesDathostStore) {}
  async capacity() {
    return { free: 10, total: 10 }
  }
  async start(req: StartServerRequest) {
    this.started.push(req)
    await this.store.set(req.matchId, `clone-${this.started.length}`)
    return { matchId: req.matchId, ip: "1.2.3.4", port: 28015, connect: "connect 1.2.3.4:28015" }
  }
  async stop(matchId: string) {
    this.stopped.push(matchId)
    await this.store.delete(matchId)
  }
  async fetchDemo(matchId: string) {
    this.demos.push(matchId)
    return Buffer.from("demo")
  }
}

describe("allocator drivers", () => {
  let h: Harness
  let surge: FakeSurge
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0, env: { AGENT_URLS: "" } })
    surge = new FakeSurge(new MatchesDathostStore(h.db))
    h.ctx.allocator.setSurgeDriver(surge)
    await h.ctx.allocator.seedGslt(["GSLTTOKEN0001"])
  })
  afterEach(async () => {
    await h.close()
  })

  async function vetoedMatch(): Promise<string> {
    const [a, b] = (await makeUsers(h.db, 2)) as [string, string]
    await h.ctx.queue.join(a, ["aim1v1"])
    await h.ctx.queue.join(b, ["aim1v1"])
    const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.clock.now())
    await h.ctx.flow.respond(a, matchId!, true)
    await h.ctx.flow.respond(b, matchId!, true)
    await finishVeto(h, matchId!)
    return matchId!
  }

  it("goes straight to DatHost when there is no Hetzner capacity at all", async () => {
    const matchId = await vetoedMatch()
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("starting")
    expect(m!.driver).toBe("dathost")
    expect(surge.started).toHaveLength(1)
  })

  it("waits SURGE_WAIT_SEC for a Hetzner slot before using DatHost", async () => {
    // A host with every slot busy, so waiting could still free one up
    await h.ctx.allocator.syncHosts(["http://agent.test:8080"])
    await h.db.update(serverSlots).set({ status: "running" })
    const matchId = await vetoedMatch()
    let [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("allocating")
    expect(surge.started).toHaveLength(0)
    h.clock.advance((h.env.SURGE_WAIT_SEC + 1) * 1000)
    await h.ctx.flow.tick()
    ;[m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("starting")
    expect(m!.driver).toBe("dathost")
    expect(m!.driverRef).toBe("clone-1")
    expect(surge.started[0]!.gslt).toBe("GSLTTOKEN0001")
  })

  it("starts on DatHost without a token when the pool is dry", async () => {
    await h.db.delete(gsltTokens)
    const matchId = await vetoedMatch()
    h.clock.advance((h.env.SURGE_WAIT_SEC + 1) * 1000)
    await h.ctx.flow.tick()
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("starting")
    expect(m!.driver).toBe("dathost")
    expect(surge.started[0]!.gslt).toBe("")
  })

  it("prefers Hetzner when a slot is free", async () => {
    await h.ctx.allocator.syncHosts(["http://agent.test:8080"])
    await vetoedMatch()
    expect(h.agent.started).toHaveLength(1)
    expect(surge.started).toHaveLength(0)
  })

  it("a cancel while the clone boots is not logged as an allocation error", async () => {
    surge.start = async (req) => {
      surge.started.push(req)
      await h.ctx.flow.cancelMatch(req.matchId, "admin", { requeue: false })
      throw new Error("DatHost GET /game-servers/x returned 404")
    }
    const matchId = await vetoedMatch()
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.status).toBe("cancelled")
    expect(m!.cancelReason).toBe("admin")
    const errors = (await h.ctx.events.recent()).filter((e) => e.type === "allocation_error")
    expect(errors).toHaveLength(0)
  })

  it("a start failure on a live match is still logged", async () => {
    surge.start = async () => {
      throw new Error("DatHost POST /game-servers returned 500")
    }
    const matchId = await vetoedMatch()
    const errors = (await h.ctx.events.recent()).filter((e) => e.type === "allocation_error" && e.matchId === matchId)
    expect(errors).toHaveLength(1)
  })

  it("pulls the DatHost demo before stopping the clone", async () => {
    const matchId = await vetoedMatch()
    h.clock.advance((h.env.SURGE_WAIT_SEC + 1) * 1000)
    await h.ctx.flow.tick()
    await h.ctx.flow.handleEvent(matchId, { type: "match_end", winnerTeam: "A", score: { A: 16, B: 3 }, players: [], demoUploaded: false })
    expect(surge.stopped).toHaveLength(0)
    await h.ctx.flow.handleEvent(matchId, { type: "demo_uploaded", ok: false, error: "no storage" })
    expect(surge.stopped).toEqual([matchId])
    const [m] = await h.db.select().from(matches).where(eq(matches.id, matchId))
    expect(m!.driverRef).toBeNull()
    expect(m!.serverReleasedAt).not.toBeNull()
  })
})

describe("allocator launch block", () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness({ rng: () => 0 })
    await h.ctx.allocator.seedGslt(["GSLTTOKEN0001"])
    await h.ctx.allocator.syncHosts(["http://agent.test:8080"])
  })
  afterEach(async () => {
    await h.close()
  })

  const demo = { bucket: "demos", key: "k.dem", presignedPutUrl: "https://s3.example.test/put" }
  const ids = ["76561198000000001", "76561198000000002", "76561198000000003", "76561198000000004", "76561198000000005", "76561198000000006"]

  function params(mode: (typeof MODES)[number], mapIndex: number) {
    const size = MODE_CONFIGS[mode].teamSize
    return {
      matchId: "3b241101-e2bb-4255-8caf-4136c566a962",
      mode,
      map: MODE_CONFIGS[mode].maps[mapIndex]!,
      teams: [
        { name: "A", steamIds: ids.slice(0, size) },
        { name: "B", steamIds: ids.slice(3, 3 + size) },
      ],
      password: "pw1234",
      webhookSecret: "0123456789abcdef",
    }
  }

  it("sends a launch block the agent accepts for every mode and map", () => {
    for (const mode of MODES) {
      MODE_CONFIGS[mode].maps.forEach((map, i) => {
        const req = h.ctx.allocator.buildRequest(params(mode, i), "GSLTTOKEN1", demo)
        expect(req.cs2).toEqual(resolveLaunch(mode, map))
        expect(() => validateLikeAgent(req)).not.toThrow()
      })
    }
  })

  it("sends the brand and the match slug for the plugin chat and match link", () => {
    const req = h.ctx.allocator.buildRequest({ ...params("aim1v1", 0), slug: "brave-amber-falcon" }, "GSLTTOKEN1", demo)
    expect(req.brand).toEqual({ name: BRAND_NAME, siteUrl: h.env.PUBLIC_URL })
    expect(req.slug).toBe("brave-amber-falcon")
    expect(StartServerRequestSchema.parse(req).slug).toBe("brave-amber-falcon")
    expect(h.ctx.allocator.buildRequest(params("aim1v1", 0), "GSLTTOKEN1", demo)).not.toHaveProperty("slug")
  })

  it("starts Rush on the agent with our Rush cfg", async () => {
    const res = await h.ctx.allocator.allocate(params("rush3v3", 0), 0)
    expect(res.kind).toBe("started")
    expect(h.agent.started[0]!.cs2).toEqual({ gameType: 0, gameMode: 6, execCfg: "rushsite_rush3v3.cfg", mapName: "rush_001" })
  })

  it("fails the start when shared names a cfg the agent does not ship", async () => {
    const cs2 = MODE_CONFIGS.rush3v3.cs2
    const saved = cs2.execCfg
    cs2.execCfg = "gamemode_rush.cfg"
    try {
      await expect(h.ctx.allocator.allocate(params("rush3v3", 0), 0)).rejects.toThrow(/no mode cfg named gamemode_rush.cfg/)
      expect(h.agent.started).toHaveLength(0)
    } finally {
      cs2.execCfg = saved
    }
  })
})
