import Link from "next/link";
import { bracketPath } from "@/components/tournaments/bracketPath";
import { LiveBadge } from "@/components/tournaments/LiveBadge";
import { resolutionText, sideMarks } from "@/components/tournaments/bracketScore";
import { mapName } from "@/lib/modes";
import type { Bracket, BracketMatch, EntryView, Mode } from "@/lib/types";
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
};

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function entryName(e: EntryView | undefined): string {
  if (!e) return "TBD";
  return e.name ?? e.players?.map((p) => p.displayName).join(", ") ?? e.captainSteamId;
}

export function entryPlayers(e: EntryView): TeamCardPlayer[] {
  return e.players ?? e.steamIds.map((steamId) => ({ steamId, displayName: steamId, avatarUrl: null }));
}

export function BracketView({ bracket, entries, highlightEntryId, mode }: BracketViewProps) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rounds = Array.from({ length: bracket.rounds }, (_, i) => i + 1);
  const path = bracketPath(bracket, highlightEntryId);
  const next = path?.nextId ? bracket.matches.find((m) => m.id === path.nextId) : undefined;

  return (
    <div className={styles.wrap}>
      {path && (
        <p className={styles.legend}>
          <span className={styles.swatch} aria-hidden="true" />
          <span>
            Your route is highlighted.{" "}
            {path.outcome === "champion"
              ? "You won the cup."
              : path.outcome === "eliminated"
                ? `Out in the ${roundName(path.round, bracket.rounds).toLowerCase()}.`
                : next
                  ? `Next: ${roundName(next.round, bracket.rounds).toLowerCase()}${next.status === "live" ? ", live now" : ""}.`
                  : ""}
          </span>
        </p>
      )}
      <div className={styles.scroller} role="region" aria-label="Bracket" tabIndex={0}>
        <ol className={styles.rounds}>
          {rounds.map((r) => {
            const matches = bracket.matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
            const bo = matches[0]?.bestOf ?? 1;
            return (
              <li key={r} className={styles.round}>
                <h3 className={styles.roundTitle}>
                  {roundName(r, bracket.rounds)} <span className="muted">Bo{bo}</span>
                </h3>
                <ol className={styles.matches}>
                  {matches.map((m) => (
                    <li key={m.id} className={cx(styles.slot, path?.connectorIds.has(m.id) && styles.pathOut)}>
                      <MatchBox
                        match={m}
                        byId={byId}
                        mode={mode}
                        highlight={highlightEntryId}
                        onPath={!!path?.matchIds.has(m.id)}
                        isNext={path?.nextId === m.id}
                      />
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ol>
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
};

function MatchBox({ match, byId, mode, highlight, onPath, isNext }: MatchBoxProps) {
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
    <div className={cx(styles.match, live && styles.live, onPath && styles.path, onPath && !placed && styles.ahead)}>
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
              <span className={cx(styles.seed, "mono")}>{s.seed ?? ""}</span>
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
                  <span className="mono">{x.mapId ? (mode ? mapName(mode, x.mapId) : x.mapId) : `Map ${x.mapNumber}`}</span>
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
      {(href || isNext || note || live) && (
        <div className={styles.footer}>
          {live && <LiveBadge />}
          {isNext && <span className={styles.next}>{placed ? "Your next match" : "Next if you win"}</span>}
          {note && <span className={styles.resolution}>{note}</span>}
          {href && (
            <Link
              href={href}
              className={styles.matchLink}
              aria-label={`${live ? "Watch" : "Open"} match room, ${names[0]} against ${names[1]}`}
            >
              {live ? "Watch" : "Match"}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
