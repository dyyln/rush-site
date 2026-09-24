"use client";

import { useEffect, useState } from "react";
import { mmss } from "@/lib/format";
import { CountdownRing } from "./CountdownRing";
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
    // Whole seconds drive the fraction, so a frozen preview and the live timer draw the same ring
    return (
      <CountdownRing
        remainingMs={sec * 1000}
        totalMs={totalSec * 1000}
        urgent={urgent}
        stroke={6}
        label={label ? `${label}: ${sec} seconds` : undefined}
      >
        <span className={cx(styles.ringText, "mono")}>{sec}</span>
      </CountdownRing>
    );
  }

  return (
    <span className={cx(styles.timer, styles[size], urgent && styles.urgent)} role="timer">
      {label && <span className={styles.label}>{label}</span>}
      <span className="mono">{text}</span>
    </span>
  );
}
