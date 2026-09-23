import { describe, expect, it } from "vitest"
import { MODE_CONFIGS, type StartServerRequest } from "@rushsite/shared"
import { createDathostDriver, createMemoryServerStore, DathostError, resolveLocation } from "./index.js"
import type { FetchInit, FetchLike, FetchResponseLike } from "./types.js"

const BASE = "https://dathost.test/api/0.1"
const MATCH_ID = "3f2b8c1e-7d4a-4b6e-9a1f-2c3d4e5f6a7b"
const CLONE = "clone123"

type Call = { method: string; path: string; query: URLSearchParams; init?: FetchInit }
type Reply = { status?: number; json?: unknown; text?: string; bytes?: Uint8Array; headers?: Record<string, string> }
type Handler = (call: Call, n: number) => Reply

function reply(r: Reply): FetchResponseLike {
  const status = r.status ?? 200
  const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "")
  const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
    text: async () => text,
    arrayBuffer: async () => {
      const b = r.bytes ?? new TextEncoder().encode(text)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
  }
}

function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts = new Map<string, number>()
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname.replace("/api/0.1", ""))
    const method = init?.method ?? "GET"
    const call: Call = { method, path, query: u.searchParams, ...(init ? { init } : {}) }
    calls.push(call)
    const key = `${method} ${path}`
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    const h = routes[key]
    if (!h) return reply({ status: 404, text: `no route ${key}` })
    return reply(h(call, n))
  }
  return { fetch, calls }
}

function request(overrides: Partial<StartServerRequest> = {}): StartServerRequest {
  return {
    matchId: MATCH_ID,
    mode: "rush3v3",
    map: { id: "rush_001", displayName: "Complex", mapName: "rush_001" },
    gslt: "GSLTTOKEN",
    password: "abc123",
    allowedSteamIds: ["76561198000000001", "76561198000000002"],
    teams: [
      { name: "Alpha", steamIds: ["76561198000000001"] },
      { name: "Bravo", steamIds: ["76561198000000002"] },
    ],
    webhookUrl: "https://api.example.com/webhooks/match/" + MATCH_ID,
    webhookSecret: "0123456789abcdef0123",
    demoUpload: { bucket: "demos", key: "k.dem", presignedPutUrl: "https://s3.example.com/put" },
    cs2: MODE_CONFIGS.rush3v3.cs2,
    ...overrides,
  }
}

const running = { id: CLONE, on: true, booting: false, ip: "dusseldorf.dathost.net", raw_ip: "203.0.113.9", ports: { game: 28015 } }

function happyRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "POST /game-servers/tmpl/duplicate": () => ({ json: { id: CLONE, on: false } }),
    [`PUT /game-servers/${CLONE}`]: () => ({ json: {} }),
    [`POST /game-servers/${CLONE}/files/cfg/match.json`]: () => ({}),
    [`POST /game-servers/${CLONE}/files/cfg/server.cfg`]: () => ({}),
    [`POST /game-servers/${CLONE}/start`]: () => ({}),
    [`GET /game-servers/${CLONE}`]: (_c, n) => ({ json: n < 3 ? { ...running, booting: true } : running }),
    [`POST /game-servers/${CLONE}/console`]: () => ({}),
    [`POST /game-servers/${CLONE}/stop`]: () => ({}),
    [`DELETE /game-servers/${CLONE}`]: () => ({}),
    ...extra,
  }
}

function driver(fetch: FetchLike, store = createMemoryServerStore()) {
  const sleeps: number[] = []
  const d = createDathostDriver({
    email: "ops@example.com",
    password: "secret",
    templateServerId: "tmpl",
    location: "frankfurt",
    fetch,
    baseUrl: BASE,
    store,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    retryBaseMs: 10,
  })
  return { d, store, sleeps }
}

async function formText(fd: FormData | undefined, key: string): Promise<string | undefined> {
  const v = fd?.get(key)
  if (v === null || v === undefined) return undefined
  return typeof v === "string" ? v : await (v as Blob).text()
}

describe("start", () => {
  it("clones, configures, uploads, starts and returns connect info", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes())
    const { d, store } = driver(fetch)

    const res = await d.start(request())

    expect(res).toEqual({
      matchId: MATCH_ID,
      ip: "203.0.113.9",
      port: 28015,
      connect: "connect 203.0.113.9:28015; password abc123",
    })
    expect(await store.get(MATCH_ID)).toBe(CLONE)

    expect(calls[0]!.init?.headers?.Authorization).toBe("Basic " + Buffer.from("ops@example.com:secret").toString("base64"))

    const dup = calls.find((c) => c.path === "/game-servers/tmpl/duplicate")!
    expect(await formText(dup.init?.body, "location")).toBe("dusseldorf")

    const put = calls.find((c) => c.method === "PUT")!
    const body = put.init?.body
    expect(await formText(body, "cs2_settings.game_mode")).toBe("custom")
    expect(await formText(body, "cs2_settings.password")).toBe("abc123")
    expect(await formText(body, "cs2_settings.steam_game_server_login_token")).toBe("GSLTTOKEN")
    expect(await formText(body, "cs2_settings.enable_gotv")).toBe("true")
    expect(await formText(body, "cs2_settings.mapgroup_start_map")).toBe("rush_001")
    expect(await formText(body, "deletion_protection")).toBe("false")

    const matchJson = JSON.parse((await formText(calls.find((c) => c.path.endsWith("match.json"))!.init?.body, "file"))!)
    expect(matchJson).toMatchObject({ matchId: MATCH_ID, winCondition: "valve_rush", password: "abc123" })
    expect(matchJson.allowedSteamIds).toHaveLength(2)

    const cfg = (await formText(calls.find((c) => c.path.endsWith("server.cfg"))!.init?.body, "file"))!
    expect(cfg).toContain('sv_password "abc123"')
    expect(cfg).toContain('mp_teamname_1 "Alpha"')
    expect(cfg).toContain("exec gamemode_rush.cfg")
    expect(cfg).toContain("exec rushsite_base.cfg")

    const order = calls.map((c) => `${c.method} ${c.path}`)
    expect(order.indexOf(`POST /game-servers/${CLONE}/start`)).toBeGreaterThan(order.indexOf(`POST /game-servers/${CLONE}/files/cfg/server.cfg`))

    const lines = await Promise.all(calls.filter((c) => c.path.endsWith("/console")).map((c) => formText(c.init?.body, "line")))
    expect(lines).toEqual(["game_type 0", "game_mode 6", "changelevel rush_001"])
  })

  it("uses a preset and no console switch for aim modes", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes())
    const { d } = driver(fetch)
    await d.start(
      request({
        mode: "aim1v1",
        map: { id: "aim_map", displayName: "aim_map", mapName: "aim_map", workshopId: "3084291314" },
        cs2: MODE_CONFIGS.aim1v1.cs2,
      }),
    )
    const put = calls.find((c) => c.method === "PUT")!
    expect(await formText(put.init?.body, "cs2_settings.game_mode")).toBe("competitive")
    expect(await formText(put.init?.body, "cs2_settings.maps_source")).toBe("workshop_single_map")
    expect(await formText(put.init?.body, "cs2_settings.workshop_single_map_id")).toBe("3084291314")
    expect(calls.some((c) => c.path.endsWith("/console"))).toBe(false)
  })

  it("deletes the clone and clears the mapping when a step fails", async () => {
    const { fetch, calls } = fakeFetch(
      happyRoutes({
        [`POST /game-servers/${CLONE}/files/cfg/server.cfg`]: () => ({ status: 400, text: "Path is a directory" }),
      }),
    )
    const { d, store } = driver(fetch)

    const err = await d.start(request()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DathostError)
    expect((err as DathostError).status).toBe(400)
    expect((err as DathostError).body).toBe("Path is a directory")

    expect(calls.some((c) => c.method === "POST" && c.path === `/game-servers/${CLONE}/start`)).toBe(false)
    expect(calls.some((c) => c.method === "POST" && c.path === `/game-servers/${CLONE}/stop`)).toBe(true)
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/game-servers/${CLONE}`)).toBe(true)
    expect(await store.get(MATCH_ID)).toBeUndefined()
  })

  it("deletes the clone when boot times out", async () => {
    const { fetch, calls } = fakeFetch(
      happyRoutes({ [`GET /game-servers/${CLONE}`]: () => ({ json: { ...running, booting: true } }) }),
    )
    const d = createDathostDriver({
      email: "a@b.c",
      password: "p",
      templateServerId: "tmpl",
      fetch,
      baseUrl: BASE,
      bootTimeoutMs: 0,
      sleep: async () => {},
    })
    await expect(d.start(request())).rejects.toThrow(/did not finish booting/)
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/game-servers/${CLONE}`)).toBe(true)
  })

  it("does not retry the duplicate call on 5xx", async () => {
    const { fetch, calls } = fakeFetch({ "POST /game-servers/tmpl/duplicate": () => ({ status: 500, text: "boom" }) })
    const { d } = driver(fetch)
    await expect(d.start(request())).rejects.toMatchObject({ status: 500, body: "boom" })
    expect(calls).toHaveLength(1)
  })

  it("rejects an invalid request before calling DatHost", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes())
    const { d } = driver(fetch)
    await expect(d.start(request({ matchId: "nope" }))).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe("stop", () => {
  it("stops and deletes the clone and forgets it", async () => {
    const { fetch, calls } = fakeFetch(happyRoutes())
    const { d, store } = driver(fetch)
    await store.set(MATCH_ID, CLONE)

    await d.stop(MATCH_ID)

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /game-servers/${CLONE}/stop`,
      `DELETE /game-servers/${CLONE}`,
    ])
    expect(await store.get(MATCH_ID)).toBeUndefined()
  })

  it("treats an already deleted server as stopped", async () => {
    const { fetch } = fakeFetch({})
    const { d, store } = driver(fetch)
    await store.set(MATCH_ID, CLONE)
    await d.stop(MATCH_ID)
    expect(await store.get(MATCH_ID)).toBeUndefined()
  })

  it("is a no-op for unknown matches", async () => {
    const { fetch, calls } = fakeFetch({})
    const { d } = driver(fetch)
    await d.stop(MATCH_ID)
    expect(calls).toHaveLength(0)
  })
})

describe("fetchDemo", () => {
  it("downloads the match demo when present", async () => {
    const own = `rushsite_${MATCH_ID}.dem`
    const { fetch, calls } = fakeFetch({
      [`GET /game-servers/${CLONE}/files`]: () => ({
        json: [{ path: "cfg/" }, { path: "zzz_other.dem", size: 5 }, { path: own, size: 10 }, { path: "gameinfo.gi" }],
      }),
      [`GET /game-servers/${CLONE}/files/${own}`]: () => ({ bytes: new Uint8Array([1, 2, 3]) }),
    })
    const { d, store } = driver(fetch)
    await store.set(MATCH_ID, CLONE)

    const buf = await d.fetchDemo!(MATCH_ID)
    expect(buf).toBeInstanceOf(Buffer)
    expect([...(buf as Buffer)]).toEqual([1, 2, 3])
    expect(calls[0]!.query.get("max_depth")).toBe("1")
  })

  it("falls back to the last .dem by name", async () => {
    const { fetch, calls } = fakeFetch({
      [`GET /game-servers/${CLONE}/files`]: () => ({
        json: [{ path: "auto_20260901.dem" }, { path: "auto_20260923.dem" }, { path: "server.cfg" }],
      }),
      [`GET /game-servers/${CLONE}/files/auto_20260923.dem`]: () => ({ text: "DEMO" }),
    })
    const { d, store } = driver(fetch)
    await store.set(MATCH_ID, CLONE)
    const buf = await d.fetchDemo!(MATCH_ID)
    expect(buf?.toString()).toBe("DEMO")
    expect(calls.at(-1)!.path).toBe(`/game-servers/${CLONE}/files/auto_20260923.dem`)
  })

  it("returns null when there is no demo or no server", async () => {
    const { fetch } = fakeFetch({ [`GET /game-servers/${CLONE}/files`]: () => ({ json: [{ path: "server.cfg" }] }) })
    const { d, store } = driver(fetch)
    expect(await d.fetchDemo!(MATCH_ID)).toBeNull()
    await store.set(MATCH_ID, CLONE)
    expect(await d.fetchDemo!(MATCH_ID)).toBeNull()
  })
})

describe("retries", () => {
  it("retries 429 honouring Retry-After then succeeds", async () => {
    const { fetch, calls } = fakeFetch(
      happyRoutes({
        "POST /game-servers/tmpl/duplicate": (_c, n) =>
          n === 1 ? { status: 429, headers: { "Retry-After": "2" } } : { json: { id: CLONE } },
      }),
    )
    const { d, sleeps } = driver(fetch)
    await d.start(request())
    expect(calls.filter((c) => c.path === "/game-servers/tmpl/duplicate")).toHaveLength(2)
    expect(sleeps[0]).toBe(2000)
  })

  it("retries 5xx with backoff on idempotent calls and gives up with DathostError", async () => {
    const { fetch, calls } = fakeFetch({ [`POST /game-servers/${CLONE}/stop`]: () => ({ status: 503, text: "down" }) })
    const { d, store, sleeps } = driver(fetch)
    await store.set(MATCH_ID, CLONE)
    const err = await d.stop(MATCH_ID).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DathostError)
    expect(err).toMatchObject({ status: 503, body: "down" })
    expect(calls).toHaveLength(5)
    expect(sleeps).toHaveLength(4)
    expect(sleeps[1]!).toBeGreaterThanOrEqual(sleeps[0]!)
    expect(await store.get(MATCH_ID)).toBe(CLONE)
  })
})

describe("misc", () => {
  it("reports capacity from the store", async () => {
    const { fetch } = fakeFetch({})
    const { d, store } = driver(fetch)
    await store.set("a", "1")
    expect(await d.capacity()).toEqual({ total: 1000, free: 999 })
  })

  it("maps city aliases to DatHost location ids", () => {
    expect(resolveLocation(undefined)).toBe("dusseldorf")
    expect(resolveLocation("Frankfurt")).toBe("dusseldorf")
    expect(resolveLocation("stockholm")).toBe("stockholm")
  })

  it("requires an email and password", () => {
    expect(() => createDathostDriver({ email: "a@b.c", password: "", templateServerId: "t" })).toThrow(/email and password/)
    expect(() => createDathostDriver({ email: "a:b", password: "p", templateServerId: "t" })).toThrow(/colon/)
  })
})
