import { TIERS } from "@rushsite/shared";
import type { RatingPoint } from "@/lib/types";
import { cx } from "./cx";
import styles from "./RatingSparkline.module.css";

type RatingSparklineProps = {
  points: RatingPoint[];
  width?: number;
  height?: number;
  label: string;
  // Draws tier band lines and end labels
  detailed?: boolean;
};

export function RatingSparkline({ points, width = 320, height = 80, label, detailed }: RatingSparklineProps) {
  if (points.length < 2) {
    return (
      <p className={cx(styles.empty, "muted")} role="img" aria-label={`${label}: not enough matches yet`}>
        Not enough matches yet
      </p>
    );
  }
  const pad = detailed ? 16 : 4;
  const ratings = points.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const span = Math.max(max - min, 20);
  const lo = min - span * 0.1;
  const hi = max + span * 0.1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (r: number) => pad + (1 - (r - lo) / (hi - lo)) * (height - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  const first = points[0]!.rating;
  const last = points[points.length - 1]!.rating;
  const up = last >= first;
  const bands = detailed ? TIERS.filter((t) => t.min !== null && t.min > lo && t.min < hi) : [];

  return (
    <figure className={cx(styles.figure, detailed && styles.detailed)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.svg}
        role="img"
        aria-label={`${label}: ${first} to ${last} over ${points.length} matches, low ${min}, high ${max}`}
      >
        {bands.map((t) => (
          <g key={t.id}>
            <line x1={pad} x2={width - pad} y1={y(t.min!)} y2={y(t.min!)} className={styles.band} />
            <text x={width - pad} y={y(t.min!) - 3} className={styles.bandLabel} textAnchor="end">
              {t.displayName} {t.min}
            </text>
          </g>
        ))}
        <path d={d} className={cx(styles.line, up ? styles.up : styles.down)} />
        <circle cx={x(points.length - 1)} cy={y(last)} r={3} className={cx(styles.dot, up ? styles.up : styles.down)} />
      </svg>
    </figure>
  );
}
