import { readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MODE_CONFIGS, type StartServerRequest } from "@rushsite/shared"
import { AgentError } from "../src/modules/match/agent.js"

// The cfgs the Go agent embeds. It refuses any execCfg not in this dir
const AGENT_CFG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../agent/internal/match/cfgs")
export const AGENT_CFGS: ReadonlySet<string> = new Set(readdirSync(AGENT_CFG_DIR).filter((f) => f.endsWith(".cfg")))

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const STEAM_ID = /^[0-9]{17}$/
const MAP_NAME = /^[A-Za-z0-9_]{1,64}$/
const WORKSHOP = /^[0-9]{1,20}$/
const GSLT = /^[A-Za-z0-9]{8,64}$/
const PASSWORD = /^[A-Za-z0-9_-]{4,64}$/
const CFG_NAME = /^[A-Za-z0-9_-]{1,64}\.cfg$/
const ARG_FLAG = /^[+-][A-Za-z0-9_]{1,64}$/
const ARG_VALUE = /^[A-Za-z0-9_.-]{1,64}$/

function bad(msg: string): never {
  throw new AgentError(`agent returned 400 {"error":"bad_request","message":"${msg}"}`, 400)
}

// Mirrors Validate in agent/internal/match/validate.go. Throws the AgentError the HTTP client would
export function validateLikeAgent(req: StartServerRequest): void {
  if (!UUID.test(req.matchId)) bad("matchId must be a UUID")
  const mode = MODE_CONFIGS[req.mode]
  if (!mode) bad(`unknown mode ${req.mode}`)
  if (!req.map?.id) bad("map.id is required")
  if (req.map.workshopId !== undefined && req.map.workshopId !== "" && !WORKSHOP.test(req.map.workshopId)) {
    bad("map.workshopId must be numeric")
  }
  const level = req.map.mapName || req.map.id
  if (!req.map.workshopId && !MAP_NAME.test(level)) bad(`map name ${level} must be A-Z a-z 0-9 _`)

  const cs2 = req.cs2
  if (!cs2) bad("cs2 is required")
  if (!Number.isInteger(cs2.gameType) || cs2.gameType < 0 || cs2.gameType > 100) bad("cs2.gameType is missing or out of range")
  if (!Number.isInteger(cs2.gameMode) || cs2.gameMode < 0 || cs2.gameMode > 100) bad("cs2.gameMode is missing or out of range")
  if (!CFG_NAME.test(cs2.execCfg)) bad("cs2.execCfg must be a plain file name ending in .cfg")
  if (!AGENT_CFGS.has(cs2.execCfg)) bad(`no mode cfg named ${cs2.execCfg} on this agent`)
  const args = cs2.extraArgs ?? []
  if (args.length > 16) bad("cs2.extraArgs has too many entries")
  for (const a of args) if (!ARG_FLAG.test(a) && !ARG_VALUE.test(a)) bad(`cs2.extraArgs entry ${a} is not allowed`)
  if (!cs2.workshopId === !cs2.mapName) bad("cs2 needs exactly one of workshopId or mapName")
  if (cs2.workshopId) {
    if (!WORKSHOP.test(cs2.workshopId)) bad("cs2.workshopId must be numeric")
    if (req.map.workshopId !== cs2.workshopId) bad("cs2.workshopId does not match map.workshopId")
  } else if (req.map.workshopId || level !== cs2.mapName) {
    bad("cs2.mapName does not match map")
  }

  if (!GSLT.test(req.gslt)) bad("gslt is malformed")
  if (!PASSWORD.test(req.password)) bad("password must be 4 to 64 of A-Z a-z 0-9 _ -")
  if (req.allowedSteamIds.length === 0) bad("allowedSteamIds is empty")
  for (const id of req.allowedSteamIds) if (!STEAM_ID.test(id)) bad(`bad steamId ${id}`)
  if (req.teams.length !== 2) bad(`want exactly 2 teams, got ${req.teams.length}`)
  const allowed = new Set(req.allowedSteamIds)
  req.teams.forEach((t, i) => {
    if (t.steamIds.length === 0 || t.steamIds.length > mode.teamSize) bad(`team ${i} has ${t.steamIds.length} players, mode allows 1 to ${mode.teamSize}`)
    for (const id of t.steamIds) if (!allowed.has(id)) bad(`team ${i} player ${id} is not in allowedSteamIds`)
  })
  let url: URL
  try {
    url = new URL(req.webhookUrl)
  } catch {
    bad("webhookUrl must be an http or https URL")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host) bad("webhookUrl must be an http or https URL")
  if (!req.webhookSecret) bad("webhookSecret is required")
  validateSeriesLikeAgent(req)
}

// Mirrors validateSeries in validate.go
function validateSeriesLikeAgent(req: StartServerRequest): void {
  const s = req.series
  if (!s) return
  if (s.bestOf < 2 || s.bestOf > 7) bad("series.bestOf must be 2 to 7")
  if (s.maps.length !== s.bestOf || s.demoUploads.length !== s.bestOf) bad("series needs bestOf maps and demoUploads")
  if (s.startMapNumber < 1 || s.startMapNumber > s.bestOf) bad("series.startMapNumber is out of range")
  s.maps.forEach((m, i) => {
    if (!m.id) bad(`series map ${i + 1} has no id`)
    if (m.workshopId) {
      if (!WORKSHOP.test(m.workshopId)) bad(`series map ${i + 1} workshopId must be numeric`)
    } else if (!MAP_NAME.test(m.mapName || m.id)) {
      bad(`map name ${m.mapName || m.id} must be A-Z a-z 0-9 _`)
    }
  })
  if (s.maps[s.startMapNumber - 1]!.id !== req.map.id) bad(`map does not match series map ${s.startMapNumber}`)
}
