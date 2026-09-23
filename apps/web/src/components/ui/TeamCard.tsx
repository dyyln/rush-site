"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TierId } from "@rushsite/shared";
import { Avatar } from "./Avatar";
import { TierChip } from "./TierChip";
import { cx } from "./cx";
import styles from "./TeamCard.module.css";

// rating is null and tier is "unranked" when the player has no rating in the mode
export type TeamCardPlayer = { steamId: string; displayName: string; avatarUrl: string | null; rating?: number | null; tier?: TierId | "unranked" };

type RatedPlayer = TeamCardPlayer & { rating: number; tier?: TierId };

function isRated(p: TeamCardPlayer): p is RatedPlayer {
  return p.rating !== undefined && p.rating !== null && p.tier !== "unranked";
}

type TeamCardProps = {
  title: string;
  players: TeamCardPlayer[];
  // Falls back to the mean of player ratings
  meanRating?: number | null;
  // Trigger content
  children: ReactNode;
  className?: string;
};

const GAP = 8;
const EDGE = 16;
const HOVER_DELAY = 150;

// Hover, focus or tap the trigger to see the team. Escape closes
export function TeamCard({ title, players, meanRating, children, className }: TeamCardProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A tap fires focus then click. Ignore the click that follows the focus
  const openedAt = useRef(0);
  const id = useId();

  const rated = players.filter(isRated);
  const mean = meanRating ?? (rated.length ? Math.round(rated.reduce((n, p) => n + p.rating, 0) / rated.length) : null);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    setOpen((was) => {
      if (!was) openedAt.current = Date.now();
      return true;
    });
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
  }, []);
  const hideSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), HOVER_DELAY);
  }, []);

  // Place below the trigger, flip above when there is no room, clamp to the viewport
  useLayoutEffect(() => {
    if (!open || !trigger.current || !card.current) return;
    const place = () => {
      const t = trigger.current!.getBoundingClientRect();
      const c = card.current!.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      let top = t.bottom + GAP;
      if (top + c.height > vh - EDGE && t.top - GAP - c.height >= EDGE) top = t.top - GAP - c.height;
      const left = Math.min(Math.max(EDGE, t.left), vw - EDGE - c.width);
      setPos({ top, left: Math.max(EDGE, left) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!trigger.current?.contains(n) && !card.current?.contains(n)) hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={cx(styles.trigger, className)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hideSoon}
        onClick={() => {
          if (!open) show();
          else if (Date.now() - openedAt.current > 400) hide();
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="tooltip"
            className={styles.card}
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
          >
            <p className={styles.title}>
              <span>{title}</span>
              {mean !== null && (
                <span className={styles.mean}>
                  Avg <span className="mono">{mean}</span>
                </span>
              )}
            </p>
            <ul className={styles.players}>
              {players.map((p) => (
                <li key={p.steamId} className={styles.player}>
                  <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
                  <span className={styles.name}>{p.displayName}</span>
                  {isRated(p) ? <TierChip tier={p.tier} rating={p.rating} size="sm" /> : <TierChip unranked size="sm" />}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
