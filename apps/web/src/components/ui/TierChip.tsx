import { TIERS, tierForRating, type TierId } from "@rushsite/shared";
import { cx } from "./cx";
import styles from "./TierChip.module.css";

type TierChipProps = {
  tier?: TierId;
  rating?: number;
  showRating?: boolean;
  size?: "sm" | "md";
};

export function TierChip({ tier, rating, showRating, size = "md" }: TierChipProps) {
  const band = tier ? TIERS.find((t) => t.id === tier)! : tierForRating(rating ?? 0);
  return (
    <span className={cx(styles.chip, styles[size])} data-tier={band.id}>
      <svg className={styles.mark} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
      </svg>
      <span>{band.displayName}</span>
      {showRating && rating !== undefined && <span className={cx(styles.rating, "mono")}>{Math.round(rating)}</span>}
    </span>
  );
}
