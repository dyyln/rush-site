import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "accent" | "win" | "loss" | "info" | "warn";

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cx(styles.badge, styles[tone], className)}>{children}</span>;
}
