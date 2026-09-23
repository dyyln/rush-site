import { PGlite } from "@electric-sql/pglite"
import type { AgentHealth, StartServerRequest, StartServerResponse } from "@rushsite/shared"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Redis } from "ioredis"
import RedisMock from "ioredis-mock"
import pino from "pino"
import { buildApp } from "../src/app.js"
import { buildContext, type AppContext } from "../src/context.js"
import { MIGRATIONS_DIR, type Db } from "../src/db/client.js"
import * as schema from "../src/db/schema.js"
import { users } from "../src/db/schema.js"
import { testEnv, type Env } from "../src/env.js"
import type { AgentApi } from "../src/modules/match/agent.js"
import { DisabledDemoStorage } from "../src/modules/match/storage.js"
import { MemoryNotifier } from "../src/modules/ws/hub.js"
import { validateLikeAgent } from "./agent-contract.js"

// One migrated PGlite per test file. Each harness truncates it instead of booting a new one
let shared: Promise<{ client: PGlite; db: Db }> | null = null

async function sharedDb(): Promise<{ client: PGlite; db: Db }> {
  shared ??= (async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR })
    return { client, db: drizzle(client, { schema }) as unknown as Db }
  })()
  return shared
}

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { client, db } = await sharedDb()
  const tables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  )
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ")
  if (names) await client.exec(`truncate ${names} restart identity cascade`)
  return { db, close: async () => undefined }
}

export function createTestRedis(): Redis {
  return new RedisMock() as unknown as Redis
}

export class FakeAgent implements AgentApi {
  started: StartServerRequest[] = []
  stopped: string[] = []
  failWith: Error | null = null
  health_: AgentHealth = { ok: true, cs2Version: "1.0", slots: { total: 4, free: 4 }, updating: false }
  // Servers GET /servers reports. start adds, stop and lose remove
  running = new Set<string>()
  listFailsWith: Error | null = null
  listCalls = 0

  async health(): Promise<AgentHealth> {
    return this.health_
  }

  // Checks each request the way the Go agent does, so a bad launch block fails the test
  async start(_url: string, req: StartServerRequest): Promise<StartServerResponse> {
    if (this.failWith) throw this.failWith
    validateLikeAgent(req)
    this.started.push(req)
    this.running.add(req.matchId)
    const port = 27015 + this.started.length
    return { matchId: req.matchId, ip: "10.0.0.1", port, connect: `connect 10.0.0.1:${port}` }
  }

  async stop(_url: string, matchId: string): Promise<void> {
    this.stopped.push(matchId)
    this.running.delete(matchId)
  }

  async list(): Promise<{ matchId: string; status: string }[]> {
    this.listCalls++
    if (this.listFailsWith) throw this.listFailsWith
    return [...this.running].map((matchId) => ({ matchId, status: "running" }))
  }

  // The process died without telling anyone, like a box reboot
  lose(matchId: string): void {
    this.running.delete(matchId)
  }
}

export class TestClock {
  constructor(public t = Date.parse("2026-09-23T12:00:00Z")) {}
  now = (): number => this.t
  advance(ms: number): void {
    this.t += ms
  }
}

export type Harness = {
  ctx: AppContext
  db: Db
  redis: Redis
  notifier: MemoryNotifier
  agent: FakeAgent
  clock: TestClock
  env: Env
  close: () => Promise<void>
}

export type HarnessOptions = {
  rng?: () => number
  env?: Partial<Record<keyof Env, string>>
  fetch?: typeof fetch
  plugins?: { tournaments?: boolean; admin?: boolean }
  surgeDriver?: import("@rushsite/shared").ServerDriver | null
}

const offline = (async () => {
  throw new Error("network disabled in tests")
}) as unknown as typeof fetch

const silent = pino({ level: "silent" })

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const { db, close } = await createTestDb()
  const redis = createTestRedis()
  await redis.flushall()
  const notifier = new MemoryNotifier()
  const agent = new FakeAgent()
  const clock = new TestClock()
  const env = testEnv({ ALLOW_UNRESOLVED_MODES: "true", AGENT_URLS: "http://agent.test:8080", GSLT_TOKENS: "GSLTTOKEN0001,GSLTTOKEN0002", ...opts.env })
  const ctx = buildContext({
    env,
    db,
    redis,
    notifier,
    log: silent,
    now: clock.now,
    ...(opts.rng ? { rng: opts.rng } : {}),
    agent,
    storage: new DisabledDemoStorage(),
    faceit: null,
    fetch: opts.fetch ?? offline,
    surgeDriver: opts.surgeDriver ?? null,
  })
  return { ctx, db, redis, notifier, agent, clock, env, close }
}

export async function createAppHarness(opts: HarnessOptions = {}) {
  const { db, close } = await createTestDb()
  const redis = createTestRedis()
  await redis.flushall()
  const notifier = new MemoryNotifier()
  const agent = new FakeAgent()
  const clock = new TestClock()
  const env = testEnv({ ALLOW_UNRESOLVED_MODES: "true", AGENT_URLS: "http://agent.test:8080", GSLT_TOKENS: "GSLTTOKEN0001,GSLTTOKEN0002", ...opts.env })
  const { app, ctx } = await buildApp({
    env,
    db,
    redis,
    notifier,
    now: clock.now,
    ...(opts.rng ? { rng: opts.rng } : {}),
    agent,
    storage: new DisabledDemoStorage(),
    faceit: null,
    fetch: opts.fetch ?? offline,
    surgeDriver: opts.surgeDriver ?? null,
    logger: false,
    plugins: opts.plugins ?? { tournaments: false, admin: false },
  })
  await app.ready()
  return {
    app,
    ctx,
    db,
    redis,
    notifier,
    agent,
    clock,
    close: async () => {
      await app.close()
      await close()
    },
  }
}

let counter = 0
export function steamId(): string {
  counter++
  return `7656119800${String(counter).padStart(7, "0")}`
}

export async function makeUsers(db: Db, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => steamId())
  await db.insert(users).values(ids.map((id) => ({ steamId: id, displayName: `player-${id.slice(-4)}` })))
  return ids
}

export async function withServers(h: { ctx: AppContext; env: Env }): Promise<void> {
  await h.ctx.allocator.seedGslt(h.env.GSLT_TOKENS)
  await h.ctx.allocator.syncHosts(h.env.AGENT_URLS)
}

// Drives a fresh 1v1 from queue to a started server and returns the match id
export async function startDuel(h: { ctx: AppContext; db: Db }, players?: [string, string]): Promise<{ matchId: string; a: string; b: string }> {
  const [a, b] = players ?? ((await makeUsers(h.db, 2)) as [string, string])
  await h.ctx.queue.join(a, ["aim1v1"])
  await h.ctx.queue.join(b, ["aim1v1"])
  const { matchmakeAll } = await import("../src/modules/queue/loop.js")
  const [matchId] = await matchmakeAll(h.ctx.queue, h.ctx.flow, h.ctx.now())
  if (!matchId) throw new Error("no match created")
  await h.ctx.flow.respond(a, matchId, true)
  await h.ctx.flow.respond(b, matchId, true)
  await finishVeto(h, matchId)
  return { matchId, a, b }
}

export async function finishVeto(h: { ctx: AppContext; db: Db }, matchId: string): Promise<void> {
  const { vetoes } = await import("../src/db/schema.js")
  const { eq } = await import("drizzle-orm")
  for (let i = 0; i < 20; i++) {
    const [row] = await h.db.select().from(vetoes).where(eq(vetoes.matchId, matchId))
    if (!row || row.done) return
    const state = row.state as import("@rushsite/shared").VetoState
    const team = state.teams[state.steps[state.stepIndex]!.team]
    for (const id of team.steamIds) await h.ctx.flow.vote(id, matchId, state.available[0]!)
  }
}
