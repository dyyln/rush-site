"use client";

import { LEADERBOARD_MIN_MATCHES, RANKED_MODES as MODES, TIERS, tierForRating, type Mode, type TierBand, type TierDistribution, type TierId } from "@rushsite/shared";
import { statsApi } from "@/components/stats/statsApi";
import { TierChip } from "@/components/ui/TierChip";
import { MODE_COPY } from "@/lib/modes";
import { useAsync } from "@/lib/useAsync";
import styles from "./ranks.module.css";

const DESCRIPTIONS: Record<TierId, string> = {
  iron: "Finding your feet. Every match here counts toward climbing out.",
  bronze: "Fundamentals in place. Crosshair placement starts to decide rounds.",
  silver: "The heart of the ladder. Consistent aim wins most duels.",
  gold: "Sharp and reliable. Small mistakes get punished here.",
  platinum: "Near the top. Every round is contested.",
  elite: "The top of the ladder. Few players reach it.",
};

function bandText(t: TierBand): string {
  if (t.min === null) return `Below ${t.max}`;
  if (t.max === null) return `${t.min}+`;
  return `${t.min} to ${t.max - 1}`;
}

function share(p: number): string {
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  return `${Math.round(v)}%`;
}

// Rating points to the next band, null at the top
function toNext(rating: number): { points: number; next: TierBand } | null {
  const idx = TIERS.findIndex((t) => t.id === tierForRating(rating).id);
  const next = TIERS[idx + 1];
  if (!next || next.min === null) return null;
  return { points: next.min - Math.round(rating), next };
}

const LADDER = [...TIERS].reverse();

export function RanksView() {
  const data = useAsync(async () => {
    const all = await Promise.all(MODES.map((m) => statsApi.distribution(m)));
    return Object.fromEntries(all.map((d) => [d.mode, d])) as Record<Mode, TierDistribution>;
  }, []);
  const dist = data.data;
  const you = dist ? MODES.filter((m) => dist[m].you) : [];

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Ranks</h1>
          <p>
            Each mode has its own rating, calculated with Glicko-2. It moves after every match based on the result and how your
            opponents are rated, and it shows from your first match. Play {LEADERBOARD_MIN_MATCHES}{" "}
            {LEADERBOARD_MIN_MATCHES === 1 ? "match" : "matches"} in a mode to appear on its leaderboard.
          </p>
        </div>
      </header>

      {you.length > 0 && dist && (
        <section aria-labelledby="ranks-you" className={styles.you}>
          <h2 id="ranks-you" className={styles.heading}>
            Your ranks
          </h2>
          <ul className={styles.youList}>
            {MODES.map((m) => {
              const y = dist[m].you;
              const n = y ? toNext(y.rating) : null;
              return (
                <li key={m} className={styles.youCard}>
                  <span className={styles.youMode}>{MODE_COPY[m].label}</span>
                  {y ? <TierChip tier={y.tier} rating={y.rating} size="sm" link={false} /> : <TierChip unranked size="sm" link={false} />}
                  <span className="muted">
                    {!y ? "No matches yet" : n ? `${n.points} rating to ${n.next.displayName}` : "Top tier"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="ranks-ladder">
        <h2 id="ranks-ladder" className={styles.heading}>
          Tiers
        </h2>
        {data.status === "error" && <p className="muted">Player shares could not be loaded.</p>}
        <ol className={styles.ladder}>
          {LADDER.map((t) => {
            const mine = dist ? MODES.filter((m) => dist[m].you?.tier === t.id) : [];
            return (
              <li key={t.id} className={styles.tier} data-current={mine.length > 0 || undefined}>
                <div className={styles.tierMain}>
                  <div className={styles.tierHead}>
                    <TierChip tier={t.id} link={false} />
                    <span className={`${styles.band} mono`}>{bandText(t)}</span>
                    {mine.length > 0 && (
                      <span className={styles.youTag}>You{mine.length < MODES.length ? `, ${mine.map((m) => MODE_COPY[m].short).join(" ")}` : ""}</span>
                    )}
                  </div>
                  <p className={styles.desc}>{DESCRIPTIONS[t.id]}</p>
                </div>
                <dl className={styles.shares}>
                  {MODES.map((m) => {
                    const row = dist?.[m].tiers.find((x) => x.tier === t.id);
                    const isMine = dist?.[m].you?.tier === t.id;
                    return (
                      <div key={m} className={styles.share} data-you={isMine || undefined}>
                        <dt>{MODE_COPY[m].label}</dt>
                        <dd className="mono">{row ? share(row.pct) : "–"}</dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ol>
        <p className={`${styles.foot} muted`}>Shares are of players placed on each leaderboard.</p>
      </section>
    </div>
  );
}
