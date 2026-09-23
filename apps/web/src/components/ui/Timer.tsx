"use client";

import { useEffect, useState } from "react";
import { mmss } from "@/lib/format";
import { cx } from "./cx";
import styles from "./Timer.module.css";

type TimerProps = {
  // Counts down to this epoch ms
  until?: number;
  // Counts up from this epoch ms
  since?: number;
  // Total seconds of the countdown. Draws a progress ring when set
  totalSec?: number;
  label?: string;
  size?: "sm" | "lg";
  // Fixed value for static previews
  frozenSec?: number;
};

function useNow(active: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Timer({ until, since, totalSec, label, size = "sm", frozenSec }: TimerProps) {
  const now = useNow(frozenSec === undefined);
  let sec = frozenSec ?? 0;
  if (frozenSec === undefined && now !== null) {
    if (until !== undefined) sec = Math.max(0, Math.ceil((until - now) / 1000));
    else if (since !== undefined) sec = Math.max(0, Math.floor((now - since) / 1000));
  }
  const counting = until !== undefined || (frozenSec !== undefined && totalSec !== undefined);
  const urgent = counting && sec <= 5;
  const text = now === null && frozenSec === undefined ? "--:--" : mmss(sec);

  if (totalSec && size === "lg") {
    const r = 44;
    const c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, sec / totalSec));
    return (
      <div className={cx(styles.ring, urgent && styles.urgent)} role="timer" aria-label={label ? `${label}: ${sec} seconds` : undefined}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={r} className={styles.track} />
          <circle
            cx="50"
            cy="50"
            r={r}
            className={styles.progress}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <span className={cx(styles.ringText, "mono")} aria-hidden="true">
          {sec}
        </span>
      </div>
    );
  }

  return (
    <span className={cx(styles.timer, styles[size], urgent && styles.urgent)} role="timer">
      {label && <span className={styles.label}>{label}</span>}
      <span className="mono">{text}</span>
    </span>
  );
}
