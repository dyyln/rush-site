"use client";

import { cx } from "./cx";
import { formatRating, useTiersOnly } from "@/lib/prefs";

// Rating number as text. Renders nothing when the viewer shows tiers only
export function RatingText({ value, className, fallback = null }: { value: number | null | undefined; className?: string; fallback?: React.ReactNode }) {
  const tiersOnly = useTiersOnly();
  const text = formatRating(value, tiersOnly);
  if (text === null) return <>{fallback}</>;
  return <span className={cx("rating-num", className)}>{text}</span>;
}
