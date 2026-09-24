"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { VetoTurnChip, turnClass, type VetoTurn } from "./VetoTurn";
import styles from "./VetoHead.module.css";

type VetoHeadProps = {
  id: string;
  // Small line above, e.g. "Map veto, step 2 of 5"
  eyebrow: string;
  turn: VetoTurn;
  next?: boolean;
  headline: string;
  // Announced when it changes
  sub: ReactNode;
  // Other lines under the sub, such as waiting on or a time out
  notes?: ReactNode;
  stepDeadline: number | null;
  totalSec: number;
  // Fixed seconds for static previews
  frozenSec?: number;
  children?: ReactNode;
};

// Header of every veto board: what the step is, whose turn, and how long is left.
// The dock shows the same countdown, so this one is for the eye
export function VetoHead({ id, eyebrow, turn, next, headline, sub, notes, stepDeadline, totalSec, frozenSec, children }: VetoHeadProps) {
  const done = turn === "done";
  return (
    <header className={cx(styles.head, !done && turnClass.band)} data-turn={turn}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <div className={styles.titleRow}>
          <h2 id={id} className={styles.headline} data-turn={turn}>
            {headline}
          </h2>
          <VetoTurnChip turn={turn} next={next} />
        </div>
        <p className={styles.sub} aria-live="polite">
          {sub}
        </p>
        {notes}
        {children}
      </div>
      {!done && (stepDeadline !== null || frozenSec !== undefined) && <StepClock until={stepDeadline} totalSec={totalSec} frozenSec={frozenSec} mine={turn === "mine"} />}
    </header>
  );
}

// Seconds left in big numbers over a bar that drains with them
function StepClock({ until, totalSec, frozenSec, mine }: { until: number | null; totalSec: number; frozenSec?: number; mine: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (frozenSec !== undefined) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [frozenSec]);
  const sec = frozenSec ?? (now === null || until === null ? null : Math.max(0, Math.ceil((until - now) / 1000)));
  const share = sec === null ? 1 : Math.min(1, sec / totalSec);
  return (
    <div className={styles.clock} data-urgent={sec !== null && sec <= 5 ? true : undefined} data-mine={mine || undefined} aria-hidden="true">
      <span className={cx(styles.clockValue, "mono")}>{sec === null ? "--" : sec}</span>
      <span className={styles.clockLabel}>sec left</span>
      <span className={styles.clockBar}>
        <span style={{ transform: `scaleX(${share})` }} />
      </span>
    </div>
  );
}
