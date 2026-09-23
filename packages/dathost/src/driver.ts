import { randomBytes } from "node:crypto"
import {
  StartServerRequestSchema,
  type ServerDriver,
  type ServerLiveness,
  type StartServerRequest,
  type StartServerResponse,
} from "@rushsite/shared"
import {
  buildMatchJson,
  buildModeCfg,
  buildServerCfg,
  consoleSwitchLines,
  dathostGameMode,
  isWorkshopId,
  modeCfgPath,
  resolveCs2,
} from "./cfg.js"
import { DathostError } from "./errors.js"
import { createHttpClient, defaultSleep, type HttpClient } from "./http.js"
import { createMemoryServerStore } from "./store.js"
import type { DathostFileEntry, DathostServer, DathostServerStore, FetchLike } from "./types.js"

// DatHost location ids are historical. These map city names to the id that is physically there.
// Source: https://dathost.readme.io/reference/server-locations-mapping
export const DATHOST_LOCATION_ALIASES: Record<string, string> = {
  frankfurt: "dusseldorf",
  paris: "strasbourg",
  london: "bristol",
  madrid: "barcelona",
}

export const DATHOST_DEFAULT_LOCATION = "dusseldorf"

export function resolveLocation(location: string | undefined): string {
  const l = (location ?? DATHOST_DEFAULT_LOCATION).trim().toLowerCase()
  return DATHOST_LOCATION_ALIASES[l] ?? l
}

export type DathostLogger = {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

export type DathostDriverOptions = {
  // DatHost account login. The API uses HTTP Basic auth with these.
  email: string
  password: string
  templateServerId: string
  // DatHost location id or a city alias like "frankfurt". Defaults to dusseldorf which is Frankfurt.
  location?: string
  fetch?: FetchLike
  baseUrl?: string
  store?: DathostServerStore
  // Reported as total by capacity(). DatHost has no documented per account server limit.
  maxServers?: number
  bootTimeoutMs?: number
  pollIntervalMs?: number
  maxRetries?: number
  retryBaseMs?: number
  sleep?: (ms: number) => Promise<void>
  // Directory the plugin writes demos to, relative to the file manager root (the csgo dir). Empty is the root.
  demoDir?: string
  // cfg the generated server.cfg execs first. Put the template's base settings in it. null skips it.
  baseCfg?: string | null
  // Safety net in case teardown is missed
  autostopMinutes?: number
  logger?: DathostLogger
}

export const DATHOST_DEFAULT_MAX_SERVERS = 1000

const noopLogger: DathostLogger = { info() {}, warn() {} }

function filePath(p: string): string {
  return "/" + p.split("/").filter(Boolean).map(encodeURIComponent).join("/")
}

function demoBaseName(matchId: string): string {
  return "rushsite_" + matchId.replace(/[^A-Za-z0-9_-]/g, "_")
}

export function createDathostDriver(opts: DathostDriverOptions): ServerDriver & { name: "dathost" } {
  if (!opts.templateServerId) throw new Error("DatHost templateServerId is required")
  const http: HttpClient = createHttpClient({
    email: opts.email,
    password: opts.password,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    ...(opts.retryBaseMs !== undefined ? { retryBaseMs: opts.retryBaseMs } : {}),
    ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
  })
  const store = opts.store ?? createMemoryServerStore()
  const location = resolveLocation(opts.location)
  const sleep = opts.sleep ?? defaultSleep
  const bootTimeoutMs = opts.bootTimeoutMs ?? 240_000
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000
  const demoDir = (opts.demoDir ?? "").replace(/^\/+|\/+$/g, "")
  const baseCfg = opts.baseCfg === undefined ? "rushsite_base.cfg" : opts.baseCfg
  const log = opts.logger ?? noopLogger
  const maxServers = opts.maxServers ?? DATHOST_DEFAULT_MAX_SERVERS

  const serverPath = (id: string) => `/game-servers/${encodeURIComponent(id)}`

  async function getServer(id: string): Promise<DathostServer> {
    return http.json<DathostServer>("GET", serverPath(id))
  }

  async function upload(id: string, path: string, content: string, type: string): Promise<void> {
    await http.request("POST", `${serverPath(id)}/files${filePath(path)}`, {
      form: { file: new Blob([content], { type }) },
    })
  }

  async function waitUntilRunning(id: string): Promise<DathostServer> {
    const deadline = Date.now() + bootTimeoutMs
    let last: DathostServer | undefined
    for (;;) {
      last = await getServer(id)
      if (last.on && !last.booting) return last
      if (Date.now() >= deadline) {
        throw new DathostError(`DatHost server ${id} did not finish booting in ${bootTimeoutMs} ms`, {
          status: 0,
          body: JSON.stringify(last),
          method: "GET",
          path: serverPath(id),
        })
      }
      await sleep(pollIntervalMs)
    }
  }

  async function destroy(id: string): Promise<void> {
    await http.request("POST", `${serverPath(id)}/stop`, { okStatuses: [404] })
    await http.request("DELETE", serverPath(id), { okStatuses: [404] })
  }

  return {
    name: "dathost",

    async capacity() {
      const used = store.count ? await store.count() : 0
      return { total: maxServers, free: Math.max(0, maxServers - used) }
    },

    async start(input: StartServerRequest): Promise<StartServerResponse> {
      const req = StartServerRequestSchema.parse(input)
      const cs2 = resolveCs2(req)
      const mode = dathostGameMode(cs2)

      const clone = await http.json<DathostServer>("POST", `${serverPath(opts.templateServerId)}/duplicate`, {
        form: { location },
        idempotent: false,
      })
      if (!clone?.id) {
        throw new DathostError("DatHost duplicate returned no server id", {
          status: 200,
          body: JSON.stringify(clone),
          method: "POST",
          path: `${serverPath(opts.templateServerId)}/duplicate`,
        })
      }
      const id = clone.id
      await store.set(req.matchId, id)
      log.info({ matchId: req.matchId, serverId: id, location }, "dathost clone created")

      try {
        const workshop = isWorkshopId(cs2.workshopId)
        await http.request("PUT", serverPath(id), {
          form: {
            name: `rushsite-${req.matchId}`,
            user_data: req.matchId,
            deletion_protection: false,
            autostop: true,
            autostop_minutes: opts.autostopMinutes ?? 30,
            "cs2_settings.password": req.password,
            "cs2_settings.rcon": randomBytes(12).toString("hex"),
            ...(req.gslt ? { "cs2_settings.steam_game_server_login_token": req.gslt } : {}),
            "cs2_settings.game_mode": mode.preset,
            "cs2_settings.enable_gotv": true,
            "cs2_settings.enable_metamod": true,
            // Workshop maps otherwise drop sv_password, tv_ and log cvars from every cfg
            "cs2_settings.disable_workshop_command_filtering": true,
            "cs2_settings.slots": Math.min(64, Math.max(5, req.allowedSteamIds.length + 1)),
            "cs2_settings.maps_source": workshop ? "workshop_single_map" : "mapgroup",
            ...(workshop
              ? { "cs2_settings.workshop_single_map_id": cs2.workshopId }
              : { "cs2_settings.mapgroup_start_map": cs2.mapName }),
          },
        })

        await upload(id, "cfg/match.json", JSON.stringify(buildMatchJson(req), null, 2), "application/json")
        await upload(id, `cfg/${modeCfgPath(req.matchId)}`, buildModeCfg(cs2), "text/plain")
        await upload(id, "cfg/server.cfg", buildServerCfg(req, baseCfg), "text/plain")

        await http.request("POST", `${serverPath(id)}/start`)
        let server = await waitUntilRunning(id)

        if (mode.needsConsoleSwitch) {
          for (const line of consoleSwitchLines(cs2)) {
            await http.request("POST", `${serverPath(id)}/console`, { form: { line } })
          }
          server = await getServer(id)
        }

        const ip = server.raw_ip || server.ip
        const port = server.ports?.game
        if (!ip || !port) {
          throw new DathostError(`DatHost server ${id} has no ip or game port`, {
            status: 200,
            body: JSON.stringify(server),
            method: "GET",
            path: serverPath(id),
          })
        }
        log.info({ matchId: req.matchId, serverId: id, ip, port }, "dathost server ready")
        return { matchId: req.matchId, ip, port, connect: `connect ${ip}:${port}; password ${req.password}` }
      } catch (err) {
        log.warn({ matchId: req.matchId, serverId: id, err }, "dathost start failed, deleting clone")
        try {
          await destroy(id)
          await store.delete(req.matchId)
        } catch (cleanupErr) {
          log.warn({ matchId: req.matchId, serverId: id, err: cleanupErr }, "dathost cleanup failed, clone may be orphaned")
        }
        throw err
      }
    },

    async stop(matchId: string): Promise<void> {
      const id = await store.get(matchId)
      if (!id) return
      await destroy(id)
      await store.delete(matchId)
      log.info({ matchId, serverId: id }, "dathost clone deleted")
    },

    // A clone we no longer track, a deleted clone or a stopped one counts as gone
    async status(matchId: string): Promise<ServerLiveness> {
      const id = await store.get(matchId)
      if (!id) return "gone"
      try {
        const server = await getServer(id)
        if (server.on || server.booting) return "alive"
        return "gone"
      } catch (err) {
        if (err instanceof DathostError && err.status === 404) return "gone"
        return "unknown"
      }
    },

    async fetchDemo(matchId: string): Promise<Buffer | null> {
      const id = await store.get(matchId)
      if (!id) return null
      const entries = await http.json<DathostFileEntry[] | null>("GET", `${serverPath(id)}/files`, {
        query: { path: demoDir || undefined, max_depth: 1 },
      })
      const demos = (entries ?? [])
        .map((e) => e.path.replace(/^\/+/, ""))
        .filter((p) => p.toLowerCase().endsWith(".dem"))
        .map((p) => (demoDir && !p.startsWith(demoDir + "/") ? `${demoDir}/${p}` : p))
      if (demos.length === 0) return null
      // The file list has no timestamps so prefer the plugin's name for this match, then the last name in order
      const own = `${demoBaseName(matchId)}.dem`
      const pick = demos.find((p) => p.split("/").pop() === own) ?? [...demos].sort().at(-1)!
      const res = await http.request("GET", `${serverPath(id)}/files${filePath(pick)}`)
      return Buffer.from(await res.arrayBuffer())
    },
  }
}
