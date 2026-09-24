"use client";

import Link from "next/link";
import { cx } from "./cx";
import styles from "./PageTabs.module.css";

export type PageTab = { key: string; label: string; href: string; count?: number };

type PageTabsProps = {
  label: string;
  items: readonly PageTab[];
  current: string;
  className?: string;
};

// Sub-navigation under a hero: the TopBar tabs' smaller sibling. Each tab is a link, so the
// url says which one is open. Use Tabs instead when a panel swaps in place
export function PageTabs({ label, items, current, className }: PageTabsProps) {
  return (
    <nav aria-label={label} className={cx(styles.nav, className)}>
      <ul className={styles.list}>
        {items.map((t) => (
          <li key={t.key}>
            <Link href={t.href} scroll={false} replace className={styles.tab} aria-current={t.key === current ? "page" : undefined}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={cx(styles.count, "mono")}>{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
