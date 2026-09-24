import Link from "next/link";
import { bracketPath } from "@/components/tournaments/bracketPath";
import { LiveBadge } from "@/components/tournaments/LiveBadge";
import type { Bracket, BracketMatch, EntryView } from "@/lib/types";
import { TeamCard, type TeamCardPlayer } from "./TeamCard";
import { TeamMarker, type TeamSide } from "./TeamMarker";
import { cx } from "./cx";
import styles from "./BracketView.module.css";

type BracketViewProps = {
  bracket: Bracket;
  entries: EntryView[];
  highlightEntryId?: string | null;
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

export function BracketView({ bracket, entries, highlightEntryId }: BracketViewProps) {
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
  const id = m.liveMatchId ?? m.games.at(-1)?.matchId;
  return id ? `/matches/${id}` : null;
}

type MatchBoxProps = {
  match: BracketMatch;
  byId: Map<string, EntryView>;
  highlight?: string | null;
  onPath: boolean;
  isNext: boolean;
};

function MatchBox({ match, byId, highlight, onPath, isNext }: MatchBoxProps) {
  const aWins = match.games.filter((g) => g.winner === "a").length;
  const bWins = match.games.filter((g) => g.winner === "b").length;
  // The viewer's entry is own. Otherwise the top slot is own
  const ownIndex = highlight && match.b === highlight ? 1 : 0;
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");
  const sides = [
    { id: match.a, seed: match.aSeed, score: aWins, resolved: match.aResolved },
    { id: match.b, seed: match.bSeed, score: bWins, resolved: match.bResolved },
  ];
  const href = matchLink(match);
  const placed = !!highlight && (match.a === highlight || match.b === highlight);
  return (
    <div className={cx("glass", styles.match, match.status === "live" && styles.live, onPath && styles.path, onPath && !placed && styles.ahead)}>
      {onPath && <span className="visually-hidden">{placed ? "Your match. " : "On your route. "}</span>}
      {sides.map((s, i) => {
        const won = !!s.id && match.winner === s.id;
        const lost = match.status === "done" && !!match.winner && !won;
        const entry = s.id ? byId.get(s.id) : undefined;
        const label = s.id ? entryName(entry) : match.round === 1 && s.resolved ? "Bye" : "TBD";
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
            <span className={cx(styles.score, "mono")}>
              {match.status === "done" && match.resolution === "played" ? s.score : ""}
              {won && <span className="visually-hidden"> winner</span>}
            </span>
          </div>
        );
      })}
      {(href || isNext || (match.resolution && match.resolution !== "played")) && (
        <div className={styles.footer}>
          {match.status === "live" && <LiveBadge />}
          {isNext && <span className={styles.next}>{placed ? "Your next match" : "Next if you win"}</span>}
          {match.resolution && match.resolution !== "played" && (
            <span className={styles.resolution}>{match.resolution.replace("_", " ")}</span>
          )}
          {href && (
            <Link href={href} className={styles.matchLink}>
              {match.status === "live" ? "Watch" : "Match"}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
