import Link from "next/link";
import type { Bracket, BracketMatch, EntryView } from "@/lib/types";
import { Badge } from "./Badge";
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

  return (
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
                  <li key={m.id} className={styles.slot}>
                    <MatchBox match={m} byId={byId} highlight={highlightEntryId} />
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function matchLink(m: BracketMatch): string | null {
  const id = m.liveMatchId ?? m.games.at(-1)?.matchId;
  return id ? `/matches/${id}` : null;
}

function MatchBox({ match, byId, highlight }: { match: BracketMatch; byId: Map<string, EntryView>; highlight?: string | null }) {
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
  return (
    <div className={cx(styles.match, match.status === "live" && styles.live)}>
      {sides.map((s, i) => {
        const won = !!s.id && match.winner === s.id;
        const lost = match.status === "done" && !!match.winner && !won;
        const entry = s.id ? byId.get(s.id) : undefined;
        const label = s.id ? entryName(entry) : match.round === 1 && s.resolved ? "Bye" : "TBD";
        return (
          <div
            key={i}
            className={cx(styles.side, won && styles.won, lost && styles.lost, s.id && s.id === highlight && styles.me)}
          >
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
      {(href || (match.resolution && match.resolution !== "played")) && (
        <div className={styles.footer}>
          {match.status === "live" && <Badge tone="win">Live</Badge>}
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
