"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatCountdown(ms: number): string {
  const { d, h, m, s } = parts(ms);
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function spoken(ms: number): string {
  const { d, h, m } = parts(ms);
  const bits = [d && `${d} days`, h && `${h} hours`, `${m} minutes`].filter(Boolean);
  return `Starts in ${bits.join(" ")}`;
}

// Ticks every second. Renders nothing time based until mounted to avoid a hydration mismatch
export function Countdown({ until, className }: { until: number; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className={className}>--:--:--</span>;
  const left = until - now;
  if (left <= 0) return <span className={className}>Starting</span>;
  return (
    <span className={className} aria-label={spoken(left)}>
      <span aria-hidden="true">{formatCountdown(left)}</span>
    </span>
  );
}
