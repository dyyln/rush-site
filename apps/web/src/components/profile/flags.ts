// One time flags kept in localStorage. Storage can be missing or blocked so every access is guarded

const PREFIX = "rushsite.seen.";

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, "1");
  } catch {
    // Not remembered. It shows again next time
  }
}
