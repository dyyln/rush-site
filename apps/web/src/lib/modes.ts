import { MODE_CONFIGS, MODES, type Mode } from "@rushsite/shared";

export { MODES };

type ModeCopy = { label: string; short: string; blurb: string; players: string };

export const MODE_COPY: Record<Mode, ModeCopy> = {
  aim1v1: {
    label: "1v1 Aim",
    short: "1v1",
    players: "1 vs 1",
    blurb: "Solo duel on a workshop aim map. First to 16 rounds.",
  },
  aim2v2: {
    label: "2v2 Aim",
    short: "2v2",
    players: "2 vs 2",
    blurb: "Queue with a duo or solo with an auto filled teammate. First to 16 rounds.",
  },
  rush3v3: {
    label: "3v3 Rush",
    short: "Rush",
    players: "3 vs 3",
    blurb: "Valve's Rush on Complex. Rooms are drawn each match. Hold the tower, take the castle.",
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

export function mapName(mode: Mode, mapId: string): string {
  return MODE_CONFIGS[mode].maps.find((m) => m.id === mapId)?.displayName ?? mapId;
}

export function isMode(value: string | null | undefined): value is Mode {
  return !!value && (MODES as readonly string[]).includes(value);
}
