import { MODE_CONFIGS, MODES, type Mode } from "@rushsite/shared";

export { MODES };

type ModeCopy = { label: string; name: string; short: string; format: string; blurb: string; players: string };

export const MODE_COPY: Record<Mode, ModeCopy> = {
  aim1v1: {
    label: "1v1 Aim",
    name: "Aim",
    short: "1v1",
    format: "1v1",
    players: "1 vs 1",
    blurb: "Aim maps, first to 16",
  },
  aim2v2: {
    label: "2v2 Aim",
    name: "Aim",
    short: "2v2",
    format: "2v2",
    players: "2 vs 2",
    blurb: "Aim maps, first to 16",
  },
  rush3v3: {
    label: "3v3 Rush",
    name: "Rush",
    short: "Rush",
    format: "3v3",
    players: "3 vs 3",
    blurb: "Valve's Rush on Complex",
  },
};

export function modeLabel(mode: Mode): string {
  return MODE_COPY[mode].label;
}

export function teamSize(mode: Mode): number {
  return MODE_CONFIGS[mode].teamSize;
}

// Veto formats that run as a website ban board on ladder matches
const LADDER_VETO_FORMATS: readonly string[] = ["bo1-ban"];

export function hasLadderVeto(mode: Mode): boolean {
  return LADDER_VETO_FORMATS.includes(MODE_CONFIGS[mode].vetoFormat);
}

// Player facing map names. Used until the shared config carries real display names
const MAP_NAMES: Record<string, string> = {
  aim_map: "Aim Map",
  aim_redline: "Redline",
  aim_ag_texture2: "AG Texture 2",
  aim_usp: "USP",
  aim_deagle7k: "Deagle 7k",
  awp_india: "AWP India",
  rush_001: "Complex",
};

export function mapName(mode: Mode, mapId: string): string {
  const configured = MODE_CONFIGS[mode].maps.find((m) => m.id === mapId)?.displayName;
  // A lower case name with underscores is still a raw map id
  if (configured && !/^[a-z0-9_]+$/.test(configured)) return configured;
  return MAP_NAMES[mapId] ?? configured ?? mapId;
}

export function isMode(value: string | null | undefined): value is Mode {
  return !!value && (MODES as readonly string[]).includes(value);
}
