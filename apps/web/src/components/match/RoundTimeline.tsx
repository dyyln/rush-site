"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { RoomImage } from "@/components/rush/RoomImage";
import { rushRoomName } from "@/lib/rushRooms";
import type { MatchKill, MatchRound } from "@/lib/types";
import { ChevronIcon } from "./icons";
import { KillFeed } from "./KillFeed";
import type { Roster } from "./roster";
import type { RushRoundPath } from "./RushRoomTrack";
import styles from "./RoundTimeline.module.css";

type Props = {
  rounds: MatchRound[];
  teamA: string;
  teamB: string;
  sideA: TeamSide;
  rush: boolean;
  // Undefined when the api sends no kill data for this viewer
  kills?: MatchKill[];
  roster: Roster;
  // Player to mark in the kill feed
  highlight?: string;
  // Rush only. Draws where play was each round under the segments
  rushPath?: RushRoundPath | null;
};

export function RoundTimeline({ rounds, teamA, teamB, sideA, rush, kills, roster, highlight, rushPath }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const panelId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  // Caret position in px from the list's left edge. Null hides it when the round is scrolled away
  const [caret, setCaret] = useState<number | null>(null);
  const openIdx = open === null ? -1 : rounds.findIndex((r) => r.round === open);

  const placeCaret = useCallback(() => {
    const list = listRef.current;
    const btn = openIdx >= 0 ? list?.querySelectorAll<HTMLButtonElement>("button")[openIdx] : undefined;
    if (!list || !btn) {
      setCaret(null);
      return;
    }
    const l = list.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const x = b.left + b.width / 2 - l.left;
    setCaret(x < 0 || x > l.width ? null : x);
  }, [openIdx]);

  useLayoutEffect(placeCaret, [placeCaret, rounds.length]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener("scroll", placeCaret, { passive: true });
    window.addEventListener("resize", placeCaret);
    return () => {
      list.removeEventListener("scroll", placeCaret);
      window.removeEventListener("resize", placeCaret);
    };
  }, [placeCaret, rounds.length === 0]);

  if (rounds.length === 0) return <p className="muted">No rounds yet.</p>;

  const sideOf = (team: string): TeamSide => (team === teamA ? sideA : sideA === "own" ? "enemy" : "own");
  const scoreOf = (r: MatchRound) => `${r.score[teamA] ?? 0}:${r.score[teamB] ?? 0}`;
  const killsOf = (round: number) => kills?.filter((k) => k.round === round) ?? [];
  const openIndex = openIdx;
  const current = openIndex >= 0 ? rounds[openIndex] : undefined;

  const select = (i: number, focus = false) => {
    const r = rounds[Math.max(0, Math.min(rounds.length - 1, i))];
    if (!r) return;
    setOpen(r.round);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>("button")[rounds.indexOf(r)];
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focus) btn?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowRight") select(i + 1, true);
    else if (e.key === "ArrowLeft") select(i - 1, true);
    else if (e.key === "Home") select(0, true);
    else if (e.key === "End") select(rounds.length - 1, true);
    else return;
    e.preventDefault();
  };

  // Fewer labels on long matches so they fit on a phone
  const minGap = rounds.length > 20 ? 5 : 3;
  let lastTick = -99;
  return (
    <section aria-labelledby="rounds-heading" className="stack">
      <div className={styles.head}>
        <h2 id="rounds-heading" className={styles.sub}>
          Rounds
        </h2>
        {kills && (
          <Button variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Hide all kills" : "All kills"}
          </Button>
        )}
      </div>
      <svg width="0" height="0" className={styles.defs} aria-hidden="true" focusable="false">
        <defs>
          <pattern id="team-enemy-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="currentColor" opacity="0.45" />
            <rect width="3" height="6" fill="currentColor" />
          </pattern>
        </defs>
      </svg>
      <p className="visually-hidden">Select a round to see its kills. Use the arrow keys to move between rounds.</p>
      <ol className={styles.timeline} ref={listRef}>
        {rounds.map((r, i) => {
          const next = rounds[i + 1];
          // Label the score where a streak ends, spaced out so labels do not collide
          const streakEnd = (!next || next.winnerTeam !== r.winnerTeam) && (!next || r.round - lastTick >= minGap);
          if (streakEnd) lastTick = r.round;
          const side = sideOf(r.winnerTeam);
          const score = scoreOf(r);
          const label = `Round ${r.round}, ${r.winnerTeam}, ${score}${rush && r.arena ? `, ${rushRoomName(r.arena)}` : ""}`;
          const selected = r.round === open;
          return (
            <li key={r.round} className={styles.round}>
              <button
                type="button"
                className={styles.hit}
                title={label}
                aria-expanded={selected}
                aria-controls={panelId}
                tabIndex={selected || (openIndex === -1 && i === rounds.length - 1) ? 0 : -1}
                onClick={() => setOpen(selected ? null : r.round)}
                onKeyDown={(e) => onKey(e, i)}
                data-selected={selected || undefined}
              >
                {side === "own" ? (
                  <span className={styles.seg} data-side="own" />
                ) : (
                  <svg className={styles.seg} data-side="enemy" aria-hidden="true" focusable="false">
                    <rect width="100%" height="100%" fill="url(#team-enemy-hatch)" />
                  </svg>
                )}
                <span className="visually-hidden">{label}</span>
              </button>
              {streakEnd && (
                <span className={`${styles.tick} mono`} aria-hidden="true">
                  {score}
                </span>
              )}
              {rushPath && (
                <PathCell path={rushPath} slot={rushPath.slotOf.get(r.round)} next={next ? rushPath.slotOf.get(next.round) : (rushPath.pending ?? undefined)} side={side} />
              )}
            </li>
          );
        })}
        {rushPath && rushPath.pending !== null && (
          <li className={styles.round} title={`Round ${(rounds.at(-1)?.round ?? 0) + 1}, being played`}>
            <span className={styles.hitPending}>
              <span className={cx(styles.seg, styles.segPending)} />
              <span className="visually-hidden">Round {(rounds.at(-1)?.round ?? 0) + 1} is being played</span>
            </span>
            <PathCell path={rushPath} slot={rushPath.pending} pending />
          </li>
        )}
      </ol>

      <div id={panelId} className={styles.panelWrap}>
        {current && (
          <Card as="div" padded={false} className={styles.panel} role="region" aria-label={`Round ${current.round}`}>
            {caret !== null && <span className={styles.caret} style={{ left: `${caret}px` }} aria-hidden="true" />}
            <div className={styles.panelHead}>
              <RoundTitle r={current} side={sideOf(current.winnerTeam)} score={scoreOf(current)} rush={rush} />
              <div className={styles.nav}>
                <Button variant="ghost" className={styles.iconBtn} onClick={() => select(openIndex - 1)} disabled={openIndex <= 0} icon={<ChevronIcon dir="left" />}>
                  <span className="visually-hidden">Previous round</span>
                </Button>
                <Button
                  variant="ghost"
                  className={styles.iconBtn}
                  onClick={() => select(openIndex + 1)}
                  disabled={openIndex >= rounds.length - 1}
                  icon={<ChevronIcon dir="right" />}
                >
                  <span className="visually-hidden">Next round</span>
                </Button>
              </div>
            </div>
            {kills ? <KillFeed kills={killsOf(current.round)} roster={roster} highlight={highlight} /> : <NoKills />}
          </Card>
        )}
      </div>

      {all && kills && (
        <ol className={styles.all} aria-label="Kills by round">
          {rounds.map((r) => (
            <li key={r.round} className={styles.allRound}>
              <RoundTitle r={r} side={sideOf(r.winnerTeam)} score={scoreOf(r)} rush={rush} />
              <KillFeed kills={killsOf(r.round)} roster={roster} highlight={highlight} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RoundTitle({ r, side, score, rush }: { r: MatchRound; side: TeamSide; score: string; rush: boolean }) {
  return (
    <h3 className={styles.roundTitle}>
      <span className="mono">Round {r.round}</span>
      <span className={styles.winner} data-side={side}>
        <TeamMarker side={side} />
        {r.winnerTeam === "draw" ? "Draw" : `${r.winnerTeam} won`}
      </span>
      <span className="mono muted">{score}</span>
      {rush && r.arena && (
        <span className={styles.arena}>
          <RoomImage room={r.arena} />
          <span className="muted">{rushRoomName(r.arena)}</span>
        </span>
      )}
    </h3>
  );
}

function NoKills() {
  return <p className="muted">Kills show here once the round is recorded.</p>;
}

const PATH_ROW = 14;
const PATH_PAD = 6;

// One round's column of the Rush graph: guide rows for the seven rooms, the round's marker at the
// room it was played in, and a line to the next round. Cells are equal width, so a line to the
// middle of the next cell runs from 50 to 150 on a 0-100 box
function PathCell({ path, slot, next, side, pending }: { path: RushRoundPath; slot: number | undefined; next?: number; side?: TeamSide; pending?: boolean }) {
  const y = (s: number) => PATH_PAD + (path.flip ? path.slots - 1 - s : s) * PATH_ROW;
  const height = PATH_PAD * 2 + (path.slots - 1) * PATH_ROW;
  return (
    <span className={styles.path} style={{ height }} aria-hidden="true">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height}>
        {Array.from({ length: path.slots }, (_, s) => (
          <line key={s} className={styles.pathGuide} data-castle={s === 0 || s === path.slots - 1 || undefined} x1={0} x2={100} y1={y(s)} y2={y(s)} vectorEffect="non-scaling-stroke" />
        ))}
        {slot !== undefined && next !== undefined && (
          <line className={styles.pathLine} data-side={side} x1={50} y1={y(slot)} x2={150} y2={y(next)} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {slot !== undefined &&
        (pending ? (
          <span className={cx(styles.pathPoint, styles.pathPending)} style={{ top: y(slot) }} />
        ) : (
          <span className={styles.pathPoint} data-side={side} style={{ top: y(slot) }}>
            {side && <TeamMarker side={side} />}
          </span>
        ))}
    </span>
  );
}
