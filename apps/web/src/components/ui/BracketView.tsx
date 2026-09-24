"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { isRushMode } from "@rushsite/shared";
import { BadgeEmblem } from "@/components/profile/BadgeEmblem";
import { bracketPath } from "@/components/tournaments/bracketPath";
import { LiveBadge } from "@/components/tournaments/LiveBadge";
import { resolutionText, sideMarks } from "@/components/tournaments/bracketScore";
import { mapName } from "@/lib/modes";
import type { Bracket, BracketMatch, CupCadence, EntryView, Mode } from "@/lib/types";
import { Badge } from "./Badge";
import { Tabs } from "./Tabs";
import { TeamCard, type TeamCardPlayer } from "./TeamCard";
import { TeamMarker, type TeamSide } from "./TeamMarker";
import { cx } from "./cx";
import styles from "./BracketView.module.css";

type BracketViewProps = {
  bracket: Bracket;
  entries: EntryView[];
  highlightEntryId?: string | null;
  // Turns map ids into map names on series scores
  mode?: Mode;
  // Picks the trophy above the final: weekly cups stand on a stepped plinth
  cadence?: CupCadence;
  // Entry picked outside the bracket, such as a hovered entrant. Everything off its route dims
  traceEntryId?: string | null;
};

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

// Short titles for the narrow mirrored columns. The full name is still spoken
const SHORT_ROUND: Record<string, string> = { Semifinals: "Semis", Quarterfinals: "Quarters" };

export function entryName(e: EntryView | undefined): string {
  if (!e) return "TBD";
  return e.name ?? e.players?.map((p) => p.displayName).join(", ") ?? e.captainSteamId;
}

export function entryPlayers(e: EntryView): TeamCardPlayer[] {
  return e.players ?? e.steamIds.map((steamId) => ({ steamId, displayName: steamId, avatarUrl: null }));
}

type Column = { round: number; matches: BracketMatch[]; half: "top" | "bottom" | null; out: "right" | "left" | null };

// Mirrored, the two halves of the draw meet at the final in the middle. Each column needs this much room,
// and the final takes MIRROR_FINAL_GROW times a column. Both match the flex values in BracketView.module.css
const MIRROR_COLUMN_MIN = 140;
const MIRROR_FINAL_GROW = 1.4;
const MIRROR_GAP = 16;

// Below this width one round shows at a time, picked from tabs, instead of scrolling sideways
const ROUNDS_TABS_MAX = 600;

type Layout = "mirrored" | "linear" | "tabs";

// Mirrored only when every column fits at its minimum width, one round at a time on narrow screens,
// otherwise rounds run left to right and scroll
function useLayout(rounds: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("linear");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cols = rounds * 2 - 1;
    const need = (cols - 1 + MIRROR_FINAL_GROW) * MIRROR_COLUMN_MIN + (cols - 1) * MIRROR_GAP;
    const check = () => {
      const w = el.clientWidth;
      setLayout(w < ROUNDS_TABS_MAX && rounds > 1 ? "tabs" : rounds >= 2 && w >= need ? "mirrored" : "linear");
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rounds]);
  return { ref, layout };
}

// The round a narrow screen opens on: the viewer's next match, else the first round still being played, else the final
function openingRound(bracket: Bracket, nextId: string | null | undefined): number {
  const next = nextId ? bracket.matches.find((m) => m.id === nextId) : undefined;
  if (next) return next.round;
  const open = bracket.matches.filter((m) => m.status !== "done").sort((a, b) => a.round - b.round)[0];
  return open?.round ?? bracket.rounds;
}

function columnsOf(bracket: Bracket, mirrored: boolean): Column[] {
  const inRound = (r: number) => bracket.matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
  const rounds = Array.from({ length: bracket.rounds }, (_, i) => i + 1);
  if (!mirrored) return rounds.map((r) => ({ round: r, matches: inRound(r), half: null, out: r < bracket.rounds ? "right" : null }));
  const before = rounds.slice(0, -1);
  const split = (r: number) => {
    const all = inRound(r);
    const cut = Math.ceil(all.length / 2);
    return [all.slice(0, cut), all.slice(cut)] as const;
  };
  return [
    ...before.map((r): Column => ({ round: r, matches: split(r)[0], half: "top", out: "right" })),
    { round: bracket.rounds, matches: inRound(bracket.rounds), half: null, out: null },
    ...before.reverse().map((r): Column => ({ round: r, matches: split(r)[1], half: "bottom", out: "left" })),
  ];
}

export function BracketView({ bracket, entries, highlightEntryId, mode, cadence, traceEntryId }: BracketViewProps) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path = bracketPath(bracket, highlightEntryId);
  const trace = bracketPath(bracket, traceEntryId);
  const { ref, layout } = useLayout(bracket.rounds);
  const mirrored = layout === "mirrored";
  const [picked, setPicked] = useState<number | null>(null);
  const shownRound = picked ?? openingRound(bracket, path?.nextId);
  const columns =
    layout === "tabs"
      ? [{ round: shownRound, matches: bracket.matches.filter((m) => m.round === shownRound).sort((a, b) => a.index - b.index), half: null, out: null }]
      : columnsOf(bracket, mirrored);

  const list = (
    <ol className={cx(styles.rounds, mirrored && styles.mirrored, layout === "tabs" && styles.single)} data-tracing={trace ? "" : undefined}>
      {columns.map((c) => {
        const bo = c.matches[0]?.bestOf ?? 1;
        const final = c.round === bracket.rounds;
        return (
          <li key={`${c.round}-${c.half ?? "all"}`} className={cx(styles.round, final && styles.finalRound)} data-out={c.out ?? undefined}>
            <h3 className={styles.roundTitle}>
              {mirrored ? (
                <>
                  <span aria-hidden="true">{SHORT_ROUND[roundName(c.round, bracket.rounds)] ?? roundName(c.round, bracket.rounds)}</span>
                  <span className="visually-hidden">{roundName(c.round, bracket.rounds)}</span>
                </>
              ) : (
                roundName(c.round, bracket.rounds)
              )}{" "}
              <span className="muted">Bo{bo}</span>
              {c.half && <span className="visually-hidden">, {c.half} half</span>}
            </h3>
            <ol className={styles.matches}>
              {c.matches.map((m) => (
                <li
                  key={m.id}
                  className={cx(
                    styles.slot,
                    path?.connectorIds.has(m.id) && styles.pathOut,
                    trace?.matchIds.has(m.id) && styles.traced,
                    trace?.connectorIds.has(m.id) && styles.tracedOut,
                  )}
                >
                  {/* Sits above the final without moving it, so the card stays level with the semis */}
                  {final && (
                    <BadgeEmblem
                      kind="cup_champion"
                      cadence={cadence}
                      size={mirrored ? 64 : 80}
                      className={cx(styles.trophy, layout === "tabs" && styles.trophyInline)}
                    />
                  )}
                  <MatchBox
                    match={m}
                    byId={byId}
                    mode={mode}
                    highlight={highlightEntryId}
                    onPath={!!path?.matchIds.has(m.id)}
                    isNext={path?.nextId === m.id}
                    compact={mirrored}
                  />
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </ol>
  );

  if (layout === "tabs") {
    return (
      <div className={styles.wrap} ref={ref}>
        <Tabs
          label="Bracket rounds"
          items={Array.from({ length: bracket.rounds }, (_, i) => {
            // Four tabs fit a phone: early rounds read R1, R2
            const name = roundName(i + 1, bracket.rounds);
            const short = SHORT_ROUND[name] ?? (name.startsWith("Round ") ? `R${i + 1}` : name);
            const label =
              short === name ? (
                name
              ) : (
                <>
                  <span aria-hidden="true">{short}</span>
                  <span className="visually-hidden">{name}</span>
                </>
              );
            return { key: String(i + 1), label };
          })}
          value={String(shownRound)}
          onChange={(k) => setPicked(Number(k))}
        >
          {list}
        </Tabs>
      </div>
    );
  }
  return (
    <div className={styles.wrap} ref={ref}>
      <div className={styles.scroller} role="region" aria-label="Bracket" tabIndex={mirrored ? undefined : 0}>
        {list}
      </div>
    </div>
  );
}

function matchLink(m: BracketMatch): string | null {
  const room = m.room ?? m.liveMatchId ?? m.games.at(-1)?.matchId;
  return room ? `/matches/${encodeURIComponent(room)}` : null;
}

type MatchBoxProps = {
  match: BracketMatch;
  byId: Map<string, EntryView>;
  mode?: Mode;
  highlight?: string | null;
  onPath: boolean;
  isNext: boolean;
  // Narrow mirrored column. Seeds are only spoken there
  compact: boolean;
};

function MatchBox({ match, byId, mode, highlight, onPath, isNext, compact }: MatchBoxProps) {
  // The viewer's entry is own. Otherwise the top slot is own
  const ownIndex = highlight && match.b === highlight ? 1 : 0;
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  const marks = sideMarks(match);
  const sides = [
    { id: match.a, seed: match.aSeed, mark: marks[0], resolved: match.aResolved },
    { id: match.b, seed: match.bSeed, mark: marks[1], resolved: match.bResolved },
  ];
  const names = sides.map((s) => (s.id ? entryName(byId.get(s.id)) : "TBD"));
  const href = matchLink(match);
  const placed = !!highlight && (match.a === highlight || match.b === highlight);
  const live = match.status === "live";
  const note = resolutionText(match);
  const series = match.bestOf > 1 && (match.maps?.length ?? 0) > 0;
  return (
    <div className={cx("glass", styles.match, href && styles.linked, live && styles.live, onPath && styles.path, onPath && !placed && styles.ahead)}>
      {onPath && <span className="visually-hidden">{placed ? "Your match. " : "On your route. "}</span>}
      {sides.map((s, i) => {
        const won = !!s.id && match.winner === s.id;
        const lost = match.status === "done" && !!match.winner && !won;
        const entry = s.id ? byId.get(s.id) : undefined;
        const label = s.id ? names[i]! : match.round === 1 && s.resolved ? "Bye" : "TBD";
        return (
          <div key={i} className={cx(styles.side, won && styles.won, lost && styles.lost, s.id && s.id === highlight && styles.me)}>
            <span className={styles.lead}>
              <TeamMarker side={sideOf(i)} />
              {compact ? (
                s.seed != null && <span className="visually-hidden">Seed {s.seed}, </span>
              ) : (
                <span className={cx(styles.seed, "mono")}>{s.seed ?? ""}</span>
              )}
            </span>
            {entry ? (
              <TeamCard title={label} players={entryPlayers(entry)} meanRating={entry.rating} className={styles.entryTrigger}>
                <span className={styles.entry}>{label}</span>
              </TeamCard>
            ) : (
              <span className={styles.entry}>{label}</span>
            )}
            <span className={cx(styles.score, "mono", won && styles.scoreWon, live && styles.scoreLive)}>
              {s.mark}
              {match.bestOf > 1 && s.mark && /^\d+$/.test(s.mark) && <span className="visually-hidden"> maps</span>}
              {won && <span className="visually-hidden"> winner</span>}
            </span>
          </div>
        );
      })}
      {series && (
        <ol className={styles.maps} aria-label={`Map scores, ${names[0]} first`}>
          {match.maps!.map((x) => {
            const drawn = x.status === "done" && !x.winner;
            return (
              <li key={x.mapNumber} className={cx(styles.map, x.status === "live" && styles.mapLive)}>
                <span className={styles.mapName}>
                  <span className={cx(styles.mapNo, "mono")}>{x.mapNumber}</span>
                  <span className="mono">{x.mapId && !(mode && isRushMode(mode)) ? (mode ? mapName(mode, x.mapId) : x.mapId) : `Map ${x.mapNumber}`}</span>
                </span>
                <span className={cx(styles.mapScore, "mono")}>
                  <span className={cx(x.winner === "a" && styles.scoreWon)}>{x.score.a}</span>
                  <span aria-hidden="true">-</span>
                  <span className="visually-hidden"> to </span>
                  <span className={cx(x.winner === "b" && styles.scoreWon)}>{x.score.b}</span>
                  {x.status === "live" && <span className={styles.mapTag}>Live</span>}
                  {drawn && <span className={styles.mapTag}>Draw</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {(live || isNext || note) && (
        <span className={styles.tags}>
          {live && <LiveBadge />}
          {isNext && <Badge tone="accent">{placed ? "Your match" : "If you win"}</Badge>}
          {note && <Badge>{note}</Badge>}
        </span>
      )}
      {/* The whole card opens the match room. Team names stay above it for their team card */}
      {href && (
        <Link href={href} className={styles.cardLink}>
          <span className="visually-hidden">
            {live ? "Watch" : "Open"} match room, {names[0]} against {names[1]}
          </span>
        </Link>
      )}
    </div>
  );
}
