import Link from "next/link";
import { TIERS, type TierDistribution } from "@rushsite/shared";
import { Card } from "@/components/ui/Card";
import styles from "./TierDistributionBar.module.css";

type Props = {
  data: TierDistribution | null;
  loading?: boolean;
};

const tierName = (id: string) => TIERS.find((t) => t.id === id)?.displayName ?? id;

function share(p: number): string {
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  return `${Math.round(v)}%`;
}

function topText(percentile: number): string {
  const top = Math.max(0.1, 100 - percentile);
  return `Top ${top < 10 ? top.toFixed(1) : Math.round(top)}%`;
}

// Stacked bar of placed players per tier with your position marked
export function TierDistributionBar({ data, loading }: Props) {
  if (!data) {
    return <Card as="div" tone="flat" padded={false} className={`${styles.wrap} ${styles.placeholder}`} aria-busy={loading ? "true" : undefined} />;
  }
  const you = data.you;
  return (
    <Card tone="flat" padded={false} className={styles.wrap} aria-label="Tier distribution">
      <div className={styles.head}>
        <p className={styles.title}>
          Tier distribution <span className="muted mono">{data.total.toLocaleString("en-GB")} placed</span>
        </p>
        <Link href="/ranks" className={styles.ranksLink}>
          How ranks work
        </Link>
        {you && (
          <p className={styles.you}>
            {you.placed ? (
              <>
                <strong>{topText(you.percentile)}</strong>
                <span className="muted"> · ahead of {you.percentile}% of placed players</span>
              </>
            ) : (
              <span className="muted">
                Your {tierName(you.tier)} rating would sit ahead of {you.percentile}% once placed
              </span>
            )}
          </p>
        )}
      </div>
      <div className={styles.barArea}>
        <div className={styles.bar} aria-hidden="true">
          {data.total === 0 ? (
            <span className={styles.empty} />
          ) : (
            data.tiers
              .filter((t) => t.count > 0)
              .map((t) => (
                <span
                  key={t.tier}
                  className={`${styles.segment} ${styles.tiered}`}
                  data-tier={t.tier}
                  data-current={you?.tier === t.tier ? "true" : undefined}
                  style={{ flexGrow: t.pct }}
                  title={`${tierName(t.tier)} ${share(t.pct)}`}
                />
              ))
          )}
        </div>
        {you && data.total > 0 && (
          <span className={styles.marker} style={{ left: `${Math.min(100, Math.max(0, you.percentile))}%` }} aria-hidden="true">
            <span className={styles.markerLabel}>You</span>
          </span>
        )}
      </div>
      <ul className={styles.legend}>
        {data.tiers.map((t) => (
          <li key={t.tier} data-tier={t.tier} className={`${styles.tiered} ${you?.tier === t.tier ? styles.legendCurrent : ""}`}>
            <span className={styles.swatch} aria-hidden="true" />
            <span className={styles.legendName}>{tierName(t.tier)}</span>
            <span className="mono muted">{share(t.pct)}</span>
            {you?.tier === t.tier && <span className="visually-hidden">, your tier</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
