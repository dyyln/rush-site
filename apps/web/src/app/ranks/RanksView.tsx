"use client";

import {
  divisionBands,
  divisionForRating,
  isTopTier,
  LEADERBOARD_MIN_MATCHES,
  RANKED_MODES as MODES,
  rankLabel,
  TIERS,
  tierForRating,
  type DivisionBand,
  type Mode,
  type TierBand,
  type TierDistribution,
  type TierId,
} from "@rushsite/shared";
import { statsApi } from "@/components/stats/statsApi";
import { TierChip } from "@/components/ui/TierChip";
import { TierEmblem } from "@/components/ui/TierEmblem";
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

function bandText(t: TierBand | DivisionBand): string {
  if (t.min === null) return `Below ${t.max}`;
  if (t.max === null) return `${t.min}+`;
  return `${t.min} to ${t.max - 1}`;
}

function share(p: number): string {
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  return `${Math.round(v)}%`;
}

// Rating points to the next division or tier, null in the top tier
function toNext(rating: number): { points: number; name: string } | null {
  const tier = tierForRating(rating);
  const d = divisionForRating(rating);
  const band = d === null ? null : divisionBands(tier)[d - 1];
  if (!band) return null;
  return { points: band.max - Math.round(rating), name: rankLabel(band.max) };
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
            Each mode has its own rating, calculated with Glicko-2. It moves after every match based on the result and how your opponents are rated, and it
            shows from your first match. Play {LEADERBOARD_MIN_MATCHES} {LEADERBOARD_MIN_MATCHES === 1 ? "match" : "matches"} in a mode to appear on its
            leaderboard.
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
                <li key={m} className={`glass ${styles.youCard}`}>
                  <span className={styles.youMode}>{MODE_COPY[m].label}</span>
                  {y ? <TierChip tier={y.tier} rating={y.rating} size="sm" link={false} /> : <TierChip unranked size="sm" link={false} />}
                  <span className="muted">{!y ? "No matches yet" : n ? `${n.points} rating to ${n.name}` : "Top tier"}</span>
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
              <li key={t.id} className={`glass ${styles.tier}`} data-current={mine.length > 0 || undefined} data-tier={t.id}>
                <TierEmblem tier={t.id} size={56} className={styles.emblem} />
                <div className={styles.tierMain}>
                  <div className={styles.tierHead}>
                    <TierChip tier={t.id} link={false} />
                    <span className={`${styles.band} mono`}>{bandText(t)}</span>
                    {mine.length > 0 && (
                      <span className={styles.youTag}>
                        <span className="visually-hidden">Your rank in </span>
                        {mine.map((m, i) => (
                          <span key={m} className={/^\dv\d$/.test(MODE_COPY[m].short) ? styles.format : undefined}>
                            {i > 0 && " "}
                            {MODE_COPY[m].short}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <p className={styles.desc}>{DESCRIPTIONS[t.id]}</p>
                  {isTopTier(t) ? (
                    <p className={styles.divisions}>No divisions. Your leaderboard place shows instead, from #1 down.</p>
                  ) : (
                    <ul className={styles.divisions} aria-label={`${t.displayName} divisions`}>
                      {[...divisionBands(t)].reverse().map((d) => (
                        <li key={d.division}>
                          <span className={styles.divName}>
                            {t.displayName} {d.numeral}
                          </span>
                          <span className="mono">{bandText(d)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
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
