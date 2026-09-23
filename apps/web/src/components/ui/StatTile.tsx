import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./StatTile.module.css";

type StatTileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: "up" | "down" | "flat";
};

export function StatTile({ label, value, sub, trend }: StatTileProps) {
  return (
    <div className={styles.tile}>
      <p className={styles.label}>{label}</p>
      <p className={cx(styles.value, "mono")}>{value}</p>
      {sub && <p className={cx(styles.sub, trend && styles[trend])}>{sub}</p>}
    </div>
  );
}
