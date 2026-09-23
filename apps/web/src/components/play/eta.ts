const STEP = 30;

function roundTo(sec: number): number {
  return Math.max(STEP, Math.round(sec / STEP) * STEP);
}

function minutes(sec: number): string {
  const m = sec / 60;
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

// Wait estimate as a range from about 0.7x to 1.5x, rounded to 30 s. "2 to 4 min"
export function etaRange(estimateSec: number): string {
  const lo = roundTo(estimateSec * 0.7);
  const hi = Math.max(lo, roundTo(estimateSec * 1.5));
  if (lo === hi) return lo < 60 ? `about ${lo} s` : `about ${minutes(lo)} min`;
  if (hi < 60) return `${lo} to ${hi} s`;
  if (lo < 60) return `${lo} s to ${minutes(hi)} min`;
  return `${minutes(lo)} to ${minutes(hi)} min`;
}
