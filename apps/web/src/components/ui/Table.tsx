import type { ReactNode } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import styles from "./Table.module.css";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  // Hidden below 600px to keep the table readable on phones
  hideOnMobile?: boolean;
  width?: string;
  // Placeholder shape while loading. Text by default
  skeleton?: "text" | "avatar" | "chip";
};

type TableProps<T> = {
  caption: string;
  captionHidden?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  highlight?: (row: T) => boolean;
  loading?: boolean;
};

export function Table<T>({ caption, captionHidden = true, columns, rows, rowKey, empty, highlight, loading }: TableProps<T>) {
  return (
    <div className={cx("glass", styles.wrap)} aria-busy={loading || undefined}>
      <table className={styles.table}>
        <caption className={captionHidden ? "visually-hidden" : styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cx(styles[c.align ?? (c.numeric ? "right" : "left")], c.hideOnMobile && styles.hideMobile)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk${i}`} className={styles.skeletonRow}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(styles[c.align ?? (c.numeric ? "right" : "left")], c.hideOnMobile && styles.hideMobile)}>
                    <SkeletonCell column={c} row={i} />
                  </td>
                ))}
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row, i) => (
              <tr key={rowKey(row)} className={cx(highlight?.(row) && styles.highlight)}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      styles[c.align ?? (c.numeric ? "right" : "left")],
                      c.numeric && "mono",
                      c.hideOnMobile && styles.hideMobile,
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// Widths vary by row so the placeholder reads like real names and numbers
const NAME_WIDTHS = ["55%", "40%", "65%", "48%", "35%", "58%"];

function SkeletonCell<T>({ column, row }: { column: Column<T>; row: number }) {
  const end = column.align === "right" || (column.numeric && column.align !== "left" && column.align !== "center");
  const cls = cx(styles.skeletonCell, end && styles.skeletonEnd);
  if (column.skeleton === "avatar") {
    return (
      <span className={cls}>
        <Skeleton shape="avatar" width={28} height={28} />
        <Skeleton width={NAME_WIDTHS[row % NAME_WIDTHS.length]} />
      </span>
    );
  }
  if (column.skeleton === "chip") {
    return (
      <span className={cls}>
        <Skeleton shape="block" width={96} height={22} style={{ borderRadius: "var(--radius-sm)" }} />
      </span>
    );
  }
  return (
    <span className={cls}>
      <Skeleton width={column.numeric ? "3ch" : NAME_WIDTHS[row % NAME_WIDTHS.length]} />
    </span>
  );
}
