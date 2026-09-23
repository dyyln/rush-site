// Axis helpers shared by the admin charts

export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function ticks(max: number, count = 4): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

export function compact(n: number): string {
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toFixed(1);
}

export function timeLabel(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs > 2 * 86_400_000) return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fullTime(t: number, stepSec: number): string {
  const d = new Date(t);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (stepSec <= 60) return `${date} ${time}`;
  const end = new Date(t + stepSec * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time} to ${end}`;
}

// Evenly spaced x tick positions that land on whole buckets
export function xTickIndexes(n: number, want: number): number[] {
  if (n <= 1) return [0];
  const every = Math.max(1, Math.ceil(n / want));
  const out: number[] = [];
  for (let i = 0; i < n; i += every) out.push(i);
  return out;
}
