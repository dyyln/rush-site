"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { RoomImage } from "@/components/rush/RoomImage";
import { rushRoomName } from "@/lib/rushRooms";
import type { MatchKill, MatchRound } from "@/lib/types";
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
  // A clicked round stays picked. Hover and keyboard focus show a round for as long as they last
  const [pinned, setPinned] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const feedId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const feedRef = useRef<HTMLOListElement>(null);
  // While a round is pointed at, the feed keeps the height it had, so the page does not get shorter,
  // scroll up and pull the rounds out from under the pointer
  const [lockHeight, setLockHeight] = useState<number | null>(null);
  const peek = (round: number) => {
    if (lockHeight === null && feedRef.current) setLockHeight(feedRef.current.offsetHeight);
    setHover(round);
  };
  const unpeek = () => {
    setHover(null);
    setLockHeight(null);
  };

  if (rounds.length === 0) return <p className="muted">No rounds yet.</p>;

  const sideOf = (team: string): TeamSide => (team === teamA ? sideA : sideA === "own" ? "enemy" : "own");
  const scoreOf = (r: MatchRound) => `${r.score[teamA] ?? 0}:${r.score[teamB] ?? 0}`;
  const killsOf = (round: number) => kills?.filter((k) => k.round === round) ?? [];
  const shown = hover ?? pinned;
  const pinnedIndex = pinned === null ? -1 : rounds.findIndex((r) => r.round === pinned);
  const feedRounds = shown === null ? rounds : rounds.filter((r) => r.round === shown);

  // Arrow keys move the pick along the rounds, as in a toolbar
  const select = (i: number) => {
    const r = rounds[Math.max(0, Math.min(rounds.length - 1, i))];
    if (!r) return;
    setPinned(r.round);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>("button")[rounds.indexOf(r)];
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
    btn?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowRight") select(i + 1);
    else if (e.key === "ArrowLeft") select(i - 1);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(rounds.length - 1);
    else if (e.key === "Escape") setPinned(null);
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
        {pinned !== null && (
          <Button variant="ghost" onClick={() => setPinned(null)}>
            Show all rounds
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
      <p className="visually-hidden">Point at or focus a round to see only its kills. Select it to keep it. Use the arrow keys to move between rounds.</p>
      <ol className={styles.timeline} ref={listRef} onMouseLeave={unpeek}>
        {rounds.map((r, i) => {
          const next = rounds[i + 1];
          // Label the score where a streak ends, spaced out so labels do not collide
          const streakEnd = (!next || next.winnerTeam !== r.winnerTeam) && (!next || r.round - lastTick >= minGap);
          if (streakEnd) lastTick = r.round;
          const side = sideOf(r.winnerTeam);
          const score = scoreOf(r);
          const label = `Round ${r.round}, ${r.winnerTeam}, ${score}${rush && r.arena ? `, ${rushRoomName(r.arena)}` : ""}`;
          const selected = r.round === pinned;
          return (
            <li key={r.round} className={styles.round}>
              <button
                type="button"
                className={styles.hit}
                title={label}
                aria-pressed={selected}
                aria-controls={feedId}
                tabIndex={selected || (pinnedIndex === -1 && i === rounds.length - 1) ? 0 : -1}
                onClick={() => setPinned(selected ? null : r.round)}
                onMouseEnter={() => peek(r.round)}
                onFocus={() => peek(r.round)}
                // Arrowing to the next round keeps the lock. Leaving the rounds lets go
                onBlur={(e) => !listRef.current?.contains(e.relatedTarget as Node | null) && unpeek()}
                onKeyDown={(e) => onKey(e, i)}
                data-selected={selected || undefined}
                data-shown={(shown === r.round && !selected) || undefined}
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

      {/* Every round's kills, or only the round pointed at or picked */}
      <ol id={feedId} ref={feedRef} style={lockHeight !== null ? { minHeight: lockHeight } : undefined} className={styles.all} aria-label={shown === null ? "Kills by round" : `Kills in round ${shown}`}>
        {feedRounds.map((r) => (
          <li key={r.round} className={styles.allRound}>
            <RoundInfo r={r} side={sideOf(r.winnerTeam)} score={scoreOf(r)} rush={rush} />
            <div className={styles.roundKills}>{kills ? <KillFeed kills={killsOf(r.round)} roster={roster} highlight={highlight} /> : <NoKills />}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Left of each round's kills: the round number in the winner's colour, the score and, in Rush, the room
function RoundInfo({ r, side, score, rush }: { r: MatchRound; side: TeamSide; score: string; rush: boolean }) {
  const room = rush && r.arena ? rushRoomName(r.arena) : null;
  return (
    <div className={styles.roundInfo}>
      <h3 className="visually-hidden">
        Round {r.round}, {r.winnerTeam === "draw" ? "draw" : `${r.winnerTeam} won`}, {score}
        {room ? `, ${room}` : ""}
      </h3>
      <span className={styles.roundTop} aria-hidden="true">
        <span className={cx(styles.roundBadge, "mono")} data-side={r.winnerTeam === "draw" ? undefined : side} title={r.winnerTeam === "draw" ? "Draw" : `${r.winnerTeam} won`}>
          {r.round}
        </span>
        <span className={cx(styles.roundScore, "mono")}>{score}</span>
      </span>
      {rush && r.arena && (
        <span className={styles.roundRoom} aria-hidden="true">
          <RoomImage room={r.arena} />
          <span className={styles.roundRoomName}>{room}</span>
        </span>
      )}
    </div>
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
