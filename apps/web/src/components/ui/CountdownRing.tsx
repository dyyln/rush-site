"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./CountdownRing.module.css";

// Milliseconds left until an epoch ms, ticking every tickMs. Null until mounted so SSR and hydration agree
export function useRemainingMs(until: number | null | undefined, tickMs = 250): number | null {
  const [now, setNow] = useState<number | null>(null);
  const active = until !== null && until !== undefined;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [until, tickMs, active]);
  return now === null || !active ? null : Math.max(0, until - now);
}

export type CountdownState = {
  // Null before the first tick
  remainingMs: number | null;
  // Whole seconds left, rounded up
  sec: number | null;
  urgent: boolean;
};

type CountdownRingProps = {
  // Counts down to this epoch ms. The ring ticks by itself
  until?: number;
  // Controlled value, for callers that already tick or show a frozen preview. Wins over until
  remainingMs?: number | null;
  // Length of the full ring
  totalMs: number;
  // Turns the ring to the loss colour at or below this many ms left. 0 never warns
  warnMs?: number;
  // Forces the warning state, for callers with their own rule
  urgent?: boolean;
  // Any CSS length. Defaults to 112px
  size?: string;
  // Stroke width in viewBox units (the ring is 100 wide)
  stroke?: number;
  tickMs?: number;
  // With a label the ring is a role="timer" with that name. Without one it is decorative and the
  // caller supplies the text alternative. role="timer" is not live, so nothing is announced per tick
  label?: string;
  className?: string;
  children?: ReactNode | ((state: CountdownState) => ReactNode);
};

const R = 44;
const C = 2 * Math.PI * R;

// Draining progress ring with free centre content. The fraction follows the milliseconds so it moves
// smoothly between ticks, and the CSS transition is dropped under reduced motion
export function CountdownRing({
  until,
  remainingMs: controlled,
  totalMs,
  warnMs = 5000,
  urgent: urgentProp,
  size,
  stroke = 5,
  tickMs = 250,
  label,
  className,
  children,
}: CountdownRingProps) {
  const isControlled = controlled !== undefined;
  const ticked = useRemainingMs(isControlled ? null : until, tickMs);
  const remainingMs = isControlled ? controlled : ticked;
  const sec = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const frac = remainingMs === null || totalMs <= 0 ? 1 : Math.max(0, Math.min(1, remainingMs / totalMs));
  const urgent = urgentProp ?? (warnMs > 0 && sec !== null && sec * 1000 <= warnMs);
  const style = {
    ...(size ? { "--ring-size": size } : null),
    "--ring-tick": `${tickMs}ms`,
  } as CSSProperties;

  return (
    <div
      className={cx(styles.ring, urgent && styles.urgent, className)}
      style={style}
      {...(label ? { role: "timer", "aria-label": label } : { "aria-hidden": true })}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} className={styles.track} strokeWidth={stroke} />
        <circle
          cx="50"
          cy="50"
          r={R}
          className={styles.progress}
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      {children !== undefined && (
        <span className={styles.center} aria-hidden={label ? true : undefined}>
          {typeof children === "function" ? children({ remainingMs, sec, urgent }) : children}
        </span>
      )}
    </div>
  );
}
