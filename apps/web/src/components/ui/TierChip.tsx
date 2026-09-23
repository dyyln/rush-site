import Link from "next/link";
import type { ReactNode } from "react";
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
  // No matches in the mode yet. Grey, no rating
  unranked?: boolean;
  // Links to /ranks by default. Turn off inside other links, labels or buttons
  link?: boolean;
};

function Wrap({ link, children }: { link: boolean; children: ReactNode }) {
  if (!link) return <>{children}</>;
  return (
    <Link href="/ranks" className={styles.link} title="See all ranks">
      {children}
    </Link>
  );
}

export function TierChip({ tier, rating, size = "md", unranked, link = true }: TierChipProps) {
  if (unranked) {
    return (
      <Wrap link={link}>
        <span className={cx(styles.chip, styles[size])} data-tier="unranked">
          <span>Unranked</span>
        </span>
      </Wrap>
    );
  }
  const band = tier ? TIERS.find((t) => t.id === tier)! : tierForRating(rating ?? 0);
  return (
    <Wrap link={link}>
      <span className={cx(styles.chip, styles[size])} data-tier={band.id}>
        <svg className={styles.mark} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
        </svg>
        <span>{band.displayName}</span>
        {rating !== undefined && <span className={cx(styles.rating, "mono")}>{Math.round(rating)}</span>}
      </span>
    </Wrap>
  );
}
