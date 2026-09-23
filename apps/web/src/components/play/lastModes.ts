import { MODES, type Mode } from "@rushsite/shared";

const KEY = "rushsite.play.lastModes";

// Last queued modes so Play again keeps them after a reload
export function loadLastModes(): Mode[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((m): m is Mode => (MODES as readonly string[]).includes(m)) : [];
  } catch {
    return [];
  }
}

export function saveLastModes(modes: Mode[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(modes));
  } catch {
    // Storage blocked. The selection still lives in memory
  }
}
