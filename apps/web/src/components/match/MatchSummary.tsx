import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { mmss, signed } from "@/lib/format";
import type { MatchDetail } from "@/lib/types";
import { mvpReason, type Roster } from "./roster";
import styles from "./MatchSummary.module.css";

type Props = { m: MatchDetail; roster: Roster; ownIndex: number; viewer?: string | null };

export function MatchSummary({ m, roster, ownIndex, viewer }: Props) {
  const mvp = m.mvp ? roster.get(m.mvp.steamId) : undefined;
  const [a, b] = m.teams;
  if (!a || !b) return null;
  const draw = a.score === b.score;
  const winner = a.score > b.score ? a : b;
  const played = m.teams.some((t) => t.players.some((p) => p.steamId === viewer));
  const ownWon = !draw && m.teams[ownIndex] === winner;
  const headline = draw ? "Draw" : played ? (ownWon ? "Victory" : "Defeat") : `${winner.name} won`;
  const duration =
    m.startedAt && m.endedAt ? mmss((new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 1000) : null;
  const sideOf = (i: number): TeamSide => (i === ownIndex ? "own" : "enemy");

  return (
    <section className={styles.summary} aria-labelledby="summary-heading">
      <div className={styles.result}>
        <p className="eyebrow">Final</p>
        <h2 id="summary-heading" className={styles.headline} data-result={draw ? "draw" : played ? (ownWon ? "win" : "loss") : "neutral"}>
          {headline}
        </h2>
        <p className={styles.final}>
          <span className={styles.finalTeam} data-side={sideOf(0)}>
            <TeamMarker side={sideOf(0)} />
            <span className={styles.ellipsis}>{a.name}</span>
          </span>
          <span className={`${styles.finalScore} mono`}>
            {a.score}:{b.score}
          </span>
          <span className={styles.finalTeam} data-side={sideOf(1)}>
            <TeamMarker side={sideOf(1)} />
            <span className={styles.ellipsis}>{b.name}</span>
          </span>
        </p>
        {duration && (
          <p className="muted">
            <span className="mono">{duration}</span> played
          </p>
        )}
      </div>

      {mvp && m.mvp && (
        <div className={styles.mvp} data-side={mvp.side}>
          <Avatar name={mvp.player.displayName} src={mvp.player.avatarUrl} size="lg" />
          <div className={styles.mvpText}>
            <p className={styles.mvpTag}>MVP</p>
            <p className={styles.mvpName}>
              <TeamMarker side={mvp.side} />
              <Link href={`/profile/${mvp.player.steamId}`}>{mvp.player.displayName}</Link>
            </p>
            <p className={styles.mvpReason}>{mvpReason(m.mvp.reason, mvp.player)}</p>
          </div>
        </div>
      )}

      <div className={styles.deltas}>
        <h3 className={styles.deltaHeading}>Rating changes</h3>
        {m.ratingDeltas ? (
          <div className={styles.deltaTeams}>
            {m.teams.map((t, i) => (
              <ul key={t.name} className={styles.deltaList} aria-label={`${t.name} rating changes`}>
                {t.players.map((p) => {
                  const d = m.ratingDeltas?.[p.steamId];
                  return (
                    <li key={p.steamId} className={styles.deltaRow} data-you={p.steamId === viewer || undefined}>
                      <span className={styles.deltaName} data-side={sideOf(i)}>
                        <TeamMarker side={sideOf(i)} />
                        <span className={styles.ellipsis}>{p.displayName}</span>
                        {p.steamId === viewer && <span className="muted"> (you)</span>}
                      </span>
                      <TierChip tier={p.tier} rating={p.rating} size="sm" />
                      <span className={`${styles.delta} mono`} data-sign={d === undefined ? "none" : d >= 0 ? "up" : "down"}>
                        {d === undefined ? "n/a" : signed(d)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ))}
          </div>
        ) : (
          <p className="muted">Rating changes are not available for this match yet.</p>
        )}
      </div>
    </section>
  );
}
