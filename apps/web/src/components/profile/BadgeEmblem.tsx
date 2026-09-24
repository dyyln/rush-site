import type { BadgeKind } from "@/lib/types";
import { cx } from "@/components/ui/cx";
import styles from "./CupBadges.module.css";

// Each placing has its own outline and marking so the emblem never relies on colour alone:
// champion is a shield with a star, runner-up a hexagon with two bars, semifinalist a diamond with one bar.
// Decorative only, the placing is always written next to it.
export function BadgeEmblem({ kind, size = 48, className }: { kind: BadgeKind; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 52"
      width={size}
      height={Math.round((size * 52) / 48)}
      aria-hidden="true"
      focusable="false"
      className={cx(styles.emblem, className)}
      data-kind={kind}
    >
      {kind === "cup_champion" && (
        <>
          <path d="M24 2 44 8v18c0 13-9 20.5-20 24C13 46.5 4 39 4 26V8Z" className={styles.emblemBody} />
          <path d="M24 7.5 39 12v14c0 9.5-6.5 15.5-15 18.5C15.5 41.5 9 35.5 9 26V12Z" className={styles.emblemInner} />
          <path d="m24 14.5 3 6.3 6.8.8-5 4.7 1.3 6.8-6.1-3.4-6.1 3.4 1.3-6.8-5-4.7 6.8-.8Z" className={styles.emblemMark} />
        </>
      )}
      {kind === "cup_runner_up" && (
        <>
          <path d="M24 3 43 14v24L24 49 5 38V14Z" className={styles.emblemBody} />
          <path d="M24 9 38 17v18L24 43 10 35V17Z" className={styles.emblemInner} />
          <path d="m15 21 9-5 9 5v4.5l-9-5-9 5Z" className={styles.emblemMark} />
          <path d="m15 30 9-5 9 5v4.5l-9-5-9 5Z" className={styles.emblemMark} />
        </>
      )}
      {kind === "cup_semifinalist" && (
        <>
          <path d="M24 3 45 26 24 49 3 26Z" className={styles.emblemBody} />
          <path d="M24 10 38.5 26 24 42 9.5 26Z" className={styles.emblemInner} />
          <path d="m15.5 26.5 8.5-7.5 8.5 7.5v5l-8.5-7.5-8.5 7.5Z" className={styles.emblemMark} />
        </>
      )}
    </svg>
  );
}
