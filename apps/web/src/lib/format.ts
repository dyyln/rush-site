export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function winRate(wins: number, matches: number): number {
  return matches > 0 ? wins / matches : 0;
}

export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function shortDate(iso: string | number): string {
  return dateFmt.format(new Date(iso));
}

export function dateTime(iso: string | number): string {
  return `${dateTimeFmt.format(new Date(iso))} UTC`;
}

export const NO_DATA = "\u2013";

type StatKind = "pct" | "kd" | "int";

// Rates show an en dash when there is no data. Zero matches or a null value count as no data
export function formatStat(value: number | null | undefined, kind: StatKind, matches?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value) || matches === 0 || matches === null) return NO_DATA;
  if (kind === "pct") return pct(value);
  if (kind === "kd") return value.toFixed(2);
  return String(Math.round(value));
}
