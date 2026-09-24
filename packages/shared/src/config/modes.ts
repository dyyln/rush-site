import { Cs2StartSchema, ModeConfigSchema, MODES, type Cs2Start, type MapEntry, type Mode, type ModeConfig } from "../schemas/mode.js"

// Marks values that must be filled in before a mode can go live
export const TODO = "TODO"

// Workshop ids and sources are in maps.md
export const AIM_MAPS: readonly MapEntry[] = [
  { id: "aim_map", displayName: "Aim Map", mapName: "aim_map", workshopId: "3084291314" },
  { id: "aim_redline", displayName: "Redline", mapName: "aim_redline", workshopId: "3199551320" },
  { id: "aim_ag_texture2", displayName: "AG Texture 2", mapName: "aim_ag_texture2", workshopId: "3074961197" },
  { id: "aim_usp", displayName: "USP", mapName: "aim_usp", workshopId: "3299812021" },
  // aim_deagle7k has no CS2 upload. The slot keeps its id and plays aim_deagle
  { id: "aim_deagle7k", displayName: "Deagle", mapName: "aim_deagle", workshopId: "3075996446" },
  { id: "awp_india", displayName: "AWP India", mapName: "awp_india", workshopId: "3070290869" },
]

// Rush runs on one map. Arenas are rooms inside it drawn by the map script at load
export const RUSH_MAP: MapEntry = { id: "rush_001", displayName: "Complex", mapName: "rush_001" }

export type RushRoomId = number | "convoy"
export type RushRoom = { id: RushRoomId; displayName: string }

// Room ids as used by the rush_001 map script
export const RUSH_ROOMS = {
  startRooms: [
    { id: 101, displayName: "Spire" },
    { id: 102, displayName: "Wallbang" },
    { id: 103, displayName: "Big Box" },
    { id: 104, displayName: "Madhouse" },
  ],
  midRooms: [
    { id: 201, displayName: "Sewer" },
    { id: 202, displayName: "Dogleg" },
    { id: 203, displayName: "Trainyard" },
    { id: 204, displayName: "Crane" },
    { id: 205, displayName: "Bloc" },
    { id: 206, displayName: "Hydro" },
    { id: 207, displayName: "Atomic" },
    { id: 208, displayName: "Medusa" },
    { id: 209, displayName: "Bear" },
    { id: 210, displayName: "Steel" },
    { id: 211, displayName: "Container" },
    { id: 212, displayName: "Drop" },
  ],
  castles: {
    t: { id: 401, displayName: "T Castle" },
    ct: { id: 301, displayName: "CT Castle" },
  },
  // Swapped in at 7-7
  decider: { id: "convoy", displayName: "Convoy" },
} as const satisfies {
  startRooms: readonly RushRoom[]
  midRooms: readonly RushRoom[]
  castles: { t: RushRoom; ct: RushRoom }
  decider: RushRoom
}

export const ALL_RUSH_ROOMS: readonly RushRoom[] = [
  ...RUSH_ROOMS.startRooms,
  ...RUSH_ROOMS.midRooms,
  RUSH_ROOMS.castles.t,
  RUSH_ROOMS.castles.ct,
  RUSH_ROOMS.decider,
]

export function findRushRoom(id: RushRoomId): RushRoom | undefined {
  return ALL_RUSH_ROOMS.find((r) => r.id === id)
}

// Valve's rules as shipped in the rush_001 map script and gamemode_rush.cfg
export const RUSH_RULES = {
  maxRounds: 15,
  roundsToWin: 8,
  // A round won in the enemy castle also wins the match
  winInEnemyCastle: true,
  // Room slots per match. Slot 0 is the T castle, slot 3 the start, slot 6 the CT castle
  roomSlots: 7,
  midRoundTimeSec: 40.5,
  castleRoundTimeSec: 60.5,
  deciderRoundTimeSec: 60.5,
} as const

export const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  aim1v1: {
    mode: "aim1v1",
    teamSize: 1,
    maps: [...AIM_MAPS],
    vetoFormat: "bo1-ban",
    winCondition: "first_to_13",
    cs2: { gameType: 0, gameMode: 1, execCfg: "rushsite_aim1v1.cfg" },
  },
  aim2v2: {
    mode: "aim2v2",
    teamSize: 2,
    maps: [...AIM_MAPS],
    vetoFormat: "bo1-ban",
    winCondition: "first_to_13",
    cs2: { gameType: 0, gameMode: 1, execCfg: "rushsite_aim2v2.cfg" },
  },
  rush3v3: {
    mode: "rush3v3",
    teamSize: 3,
    maps: [RUSH_MAP],
    vetoFormat: "none",
    winCondition: "valve_rush",
    // The game runs Valve's gamemode_rush.cfg for game_mode 6 on map load. Ours must not touch the rules
    cs2: { gameType: 0, gameMode: 6, execCfg: "rushsite_rush3v3.cfg" },
  },
  // Test queue for Rush with two players. Same map and rules as rush3v3
  rush1v1: {
    mode: "rush1v1",
    teamSize: 1,
    maps: [RUSH_MAP],
    vetoFormat: "none",
    winCondition: "valve_rush",
    cs2: { gameType: 0, gameMode: 6, execCfg: "rushsite_rush1v1.cfg" },
    test: true,
  },
}

for (const cfg of Object.values(MODE_CONFIGS)) ModeConfigSchema.parse(cfg)

// Modes with ratings, leaderboards and cups
export const RANKED_MODES: readonly Mode[] = MODES.filter((m) => !MODE_CONFIGS[m].test)

export function isTestMode(mode: Mode): boolean {
  return MODE_CONFIGS[mode].test === true
}

export function isRushMode(mode: Mode): boolean {
  return MODE_CONFIGS[mode].winCondition === "valve_rush"
}

export function getModeConfig(mode: Mode): ModeConfig {
  return MODE_CONFIGS[mode]
}

export function findMap(mode: Mode, mapId: string): MapEntry | undefined {
  return MODE_CONFIGS[mode].maps.find((m) => m.id === mapId)
}

// Modes a party of this size can queue for
export function allowedModesForParty(partySize: number): Mode[] {
  if (!Number.isInteger(partySize) || partySize < 1) return []
  return (Object.keys(MODE_CONFIGS) as Mode[]).filter((m) => MODE_CONFIGS[m].teamSize >= partySize)
}

// The cs2 block of a StartServerRequest. A workshop id wins over a map name
export function resolveLaunch(mode: Mode, map: MapEntry): Cs2Start {
  const cs2 = MODE_CONFIGS[mode].cs2
  const target = map.workshopId ? { workshopId: map.workshopId } : { mapName: map.mapName ?? map.id }
  return Cs2StartSchema.parse({ ...cs2, ...(cs2.extraArgs ? { extraArgs: [...cs2.extraArgs] } : {}), ...target })
}

// Every cfg name the agent must ship
export function agentExecCfgs(): string[] {
  return [...new Set(Object.values(MODE_CONFIGS).map((c) => c.cs2.execCfg))].sort()
}

// Lists placeholder values that still block a mode from going live
export function unresolvedConfig(mode: Mode): string[] {
  const cfg = MODE_CONFIGS[mode]
  const issues: string[] = []
  if (cfg.cs2.gameType < 0) issues.push("cs2.gameType")
  if (cfg.cs2.gameMode < 0) issues.push("cs2.gameMode")
  for (const m of cfg.maps) {
    if (m.id.includes(TODO)) issues.push(`maps.${m.id}.id`)
    if (m.workshopId?.includes(TODO)) issues.push(`maps.${m.id}.workshopId`)
    if (m.mapName?.includes(TODO)) issues.push(`maps.${m.id}.mapName`)
  }
  return issues
}
