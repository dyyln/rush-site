import { TIERS, tierForRating, type TierId } from "@rushsite/shared";
import { cx } from "./cx";
import styles from "./TierChip.module.css";

type TierChipProps = {
  tier?: TierId;
  // Shown after the tier name. Also picks the tier when tier is not given
  rating?: number;
  // Deprecated. The rating always shows when given
  showRating?: boolean;
  size?: "sm" | "md";
};

export function TierChip({ tier, rating, size = "md" }: TierChipProps) {
  const band = tier ? TIERS.find((t) => t.id === tier)! : tierForRating(rating ?? 0);
  return (
    <span className={cx(styles.chip, styles[size])} data-tier={band.id}>
      <svg className={styles.mark} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
      </svg>
      <span>{band.displayName}</span>
      {rating !== undefined && <span className={cx(styles.rating, "mono")}>{Math.round(rating)}</span>}
    </span>
  );
}
