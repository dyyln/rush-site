import {
  MODE_CONFIGS,
  type Cs2Launch,
  type Cs2Start,
  type PluginMatchConfig,
  type StartServerRequest,
} from "@rushsite/shared"

// Values accepted by cs2_settings.game_mode on DatHost
export type DathostGameMode = "competitive" | "casual" | "arms_race" | "ffa_deathmatch" | "retakes" | "wingman" | "custom"

// Standard CS2 game_type and game_mode pairs for the DatHost presets.
// Anything else, such as Rush (0/6), runs as "custom" and is switched over the console after boot.
const PRESETS: { type: number; mode: number; preset: DathostGameMode }[] = [
  { type: 0, mode: 0, preset: "casual" },
  { type: 0, mode: 1, preset: "competitive" },
  { type: 0, mode: 2, preset: "wingman" },
  { type: 1, mode: 0, preset: "arms_race" },
  { type: 1, mode: 2, preset: "ffa_deathmatch" },
]

// The launch block from shared config. The API always sends it
export function resolveCs2(req: StartServerRequest): Cs2Start {
  return req.cs2
}

export function dathostGameMode(cs2: Pick<Cs2Launch, "gameType" | "gameMode">): {
  preset: DathostGameMode
  needsConsoleSwitch: boolean
} {
  const hit = PRESETS.find((p) => p.type === cs2.gameType && p.mode === cs2.gameMode)
  return hit ? { preset: hit.preset, needsConsoleSwitch: false } : { preset: "custom", needsConsoleSwitch: true }
}

export function isWorkshopId(id: string | undefined): id is string {
  return !!id && /^\d+$/.test(id)
}

// Console lines that put a custom mode server on the right game_type, game_mode and map
export function consoleSwitchLines(cs2: Cs2Start): string[] {
  const map = isWorkshopId(cs2.workshopId) ? `host_workshop_map ${cs2.workshopId}` : `changelevel ${cs2.mapName}`
  return [`game_type ${cs2.gameType}`, `game_mode ${cs2.gameMode}`, map]
}

// Same path as on the Hetzner agent, so the plugin execs it the same way at match start
export function modeCfgPath(matchId: string): string {
  return `rushsite/matches/${matchId}/mode.cfg`
}

// The template server ships our mode cfgs at cfg/<execCfg>
export function buildModeCfg(cs2: Cs2Launch): string {
  return ["// Written by rushsite for this match", `exec ${cs2.execCfg}`].join("\n") + "\n"
}

export function buildMatchJson(req: StartServerRequest): PluginMatchConfig {
  return {
    matchId: req.matchId,
    mode: req.mode,
    map: req.map,
    allowedSteamIds: req.allowedSteamIds,
    teams: req.teams,
    password: req.password,
    webhookUrl: req.webhookUrl,
    webhookSecret: req.webhookSecret,
    demoUpload: req.demoUpload,
    winCondition: MODE_CONFIGS[req.mode].winCondition,
    ...(req.series ? { series: req.series } : {}),
    ...(req.rushRooms ? { rushRooms: req.rushRooms } : {}),
    ...(req.brand ? { brand: req.brand } : {}),
    ...(req.slug ? { slug: req.slug } : {}),
  }
}

function cfgString(s: string): string {
  return s.replace(/["\r\n;]/g, "")
}

// server.cfg runs on every map load. Base settings stay in the template's base cfg.
export function buildServerCfg(req: StartServerRequest, baseCfg: string | null): string {
  const [t1, t2] = req.teams
  const lines = [
    "// Written by rushsite for this match",
    ...(baseCfg ? [`exec ${baseCfg}`] : []),
    `hostname "rushsite ${cfgString(req.matchId)}"`,
    `sv_password "${cfgString(req.password)}"`,
    `mp_teamname_1 "${cfgString(t1?.name ?? "")}"`,
    `mp_teamname_2 "${cfgString(t2?.name ?? "")}"`,
    "tv_enable 1",
    `exec ${modeCfgPath(req.matchId)}`,
  ]
  return lines.join("\n") + "\n"
}
