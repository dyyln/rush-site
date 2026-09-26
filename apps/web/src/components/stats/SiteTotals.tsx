"use client";

import { useAsync } from "@/lib/useAsync";
import { useVisibleInterval } from "@/lib/useVisibleInterval";
import { cx } from "@/components/ui/cx";
import { statsApi } from "./statsApi";
import styles from "./SiteTotals.module.css";

const fmt = (n: number) => n.toLocaleString("en-GB");

// Players and matches played. Hidden until loaded, and on error, so nothing jumps
export function SiteTotals({ className, variant = "hero" }: { className?: string; variant?: "hero" | "strip" | "inline" }) {
  const data = useAsync(() => statsApi.totals(), []);
  useVisibleInterval(data.reload, 60_000, true);
  const t = data.data;
  if (!t) return null;
  return (
    <dl className={cx(styles.totals, styles[variant], variant === "strip" && "glass", className)}>
      <div>
        <dt>Players</dt>
        <dd className="mono">{fmt(t.players)}</dd>
      </div>
      <div>
        <dt>Matches played</dt>
        <dd className="mono">{fmt(t.matches)}</dd>
      </div>
    </dl>
  );
}
