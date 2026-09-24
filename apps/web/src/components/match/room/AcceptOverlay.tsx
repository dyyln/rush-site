"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MatchAcceptView, Mode } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { modeLabel } from "@/lib/modes";
import styles from "./AcceptOverlay.module.css";

const URGENT_SEC = 5;
// Seconds left at which screen readers hear the countdown. Every second would drown out everything else
const ANNOUNCE_AT = [10, URGENT_SEC];

function useRemainingMs(until: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return now === null ? null : Math.max(0, until - now);
}

// Drains over the accept window. The fraction follows the milliseconds so the ring moves smoothly,
// and the CSS transition between ticks is dropped under reduced motion
function CountdownRing({ remainingMs, totalSec }: { remainingMs: number | null; totalSec: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const sec = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const frac = remainingMs === null ? 1 : Math.max(0, Math.min(1, remainingMs / (totalSec * 1000)));
  const urgent = sec !== null && sec <= URGENT_SEC;
  return (
    <div className={cx(styles.ring, urgent && styles.urgent)} aria-hidden="true">
      <svg viewBox="0 0 100 100">
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
      <span className={styles.ringText}>
        <span className={cx(styles.ringSec, "mono")}>{sec ?? "--"}</span>
        <span className={styles.ringUnit}>sec</span>
      </span>
    </div>
  );
}

// The in-game style accept screen for players in the match. A native modal dialog, so the page behind
// is inert and focus stays inside. It cannot be dismissed, only answered or waited out
export function AcceptOverlay({
  accept,
  mode,
  onRespond,
}: {
  accept: MatchAcceptView;
  mode: Mode;
  onRespond: (accept: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const waitingRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const descId = useId();
  const open = !accept.responded;
  const remainingMs = useRemainingMs(accept.deadline);
  const sec = remainingMs === null ? null : Math.ceil(remainingMs / 1000);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  // Accept gets focus on open. Once answered the buttons go, so focus moves to the waiting line
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    else waitingRef.current?.focus();
  }, [open]);

  // Announce only a couple of thresholds and time running out
  const [announce, setAnnounce] = useState("");
  const lastAnnounced = useRef<number | null>(null);
  useEffect(() => {
    if (sec === null || !open) return;
    const hit = sec === 0 ? 0 : ANNOUNCE_AT.find((t) => sec === t);
    if (hit === undefined || lastAnnounced.current === hit) return;
    lastAnnounced.current = hit;
    setAnnounce(hit === 0 ? "Time to accept has run out." : `${hit} seconds left to accept.`);
  }, [sec, open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={(e) => {
        // Chrome closes a dialog on a second Escape even when cancel is prevented
        if (e.key === "Escape") e.preventDefault();
      }}
      onCancel={(e) => e.preventDefault()}
    >
      <div className={styles.panel}>
        <p className="eyebrow">{modeLabel(mode)}</p>
        <h2 id={titleId} className={styles.title}>
          Match found
        </h2>

        <CountdownRing remainingMs={remainingMs} totalSec={accept.windowSec} />
        <p className="visually-hidden" role="timer">
          {sec === null ? "" : `${sec} seconds left to accept`}
        </p>
        <p className="visually-hidden" aria-live="assertive" aria-atomic="true">
          {announce}
        </p>

        <div className={styles.count}>
          <p className={styles.countText} aria-live="polite">
            {accept.accepted} of {accept.required} accepted
          </p>
          <ol className={styles.pips} aria-hidden="true">
            {Array.from({ length: accept.required }, (_, i) => (
              <li key={i} className={i < accept.accepted ? styles.pipOn : undefined} />
            ))}
          </ol>
        </div>

        {open ? (
          <>
            <div className={styles.actions}>
              <Button size="lg" block className={styles.acceptBtn} onClick={() => onRespond(true)} data-autofocus>
                Accept
              </Button>
              <Button size="lg" block variant="ghost" onClick={() => onRespond(false)}>
                Decline
              </Button>
            </div>
            <p id={descId} className={styles.note}>
              Declining or letting the timer run out puts you on a short queue cooldown.
            </p>
          </>
        ) : (
          <p id={descId} ref={waitingRef} tabIndex={-1} className={styles.waiting}>
            Accepted. Waiting for the others.
          </p>
        )}
      </div>
    </dialog>
  );
}
