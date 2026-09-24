"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TIERS, divisionForRating, divisionNumeral, isTopTier, tierForRating, type TierId } from "@rushsite/shared";
import { useTiersOnly } from "@/lib/prefs";
import { cx } from "./cx";
import { TierEmblem } from "./TierEmblem";
import styles from "./TierChip.module.css";

type TierChipProps = {
  tier?: TierId;
  // Shown after the tier name. Also picks the tier when tier is not given
  rating?: number;
  // Leaderboard place in the mode. Shown as #rank in the top tier, which has no divisions
  rank?: number | null;
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

export function TierChip({ tier, rating, rank, size = "md", unranked, link = true }: TierChipProps) {
  const tiersOnly = useTiersOnly();
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
  // Division only when the rating agrees with the tier, so a stale tier never shows a wrong split
  const division = rating !== undefined && tierForRating(rating).id === band.id ? divisionForRating(rating) : null;
  const place = isTopTier(band) && rank != null && rank > 0 ? rank : null;
  const showRating = rating !== undefined && !tiersOnly;
  const name = division ? `${band.displayName} ${divisionNumeral(division)}` : band.displayName;
  const spoken = [name, place && `rank ${place}`, showRating && `${Math.round(rating)} rating`].filter(Boolean).join(", ");
  return (
    <Wrap link={link}>
      <span className={cx(styles.chip, styles[size])} data-tier={band.id}>
        <TierEmblem tier={band.id} className={styles.mark} />
        <span aria-hidden="true">{name}</span>
        {place && (
          <span className={cx(styles.place, "mono")} aria-hidden="true">
            #{place}
          </span>
        )}
        {showRating && (
          <span className={cx(styles.rating, "mono", "rating-num")} aria-hidden="true">
            {Math.round(rating)}
          </span>
        )}
        <span className="visually-hidden">{spoken}</span>
      </span>
    </Wrap>
  );
}
