"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND_NAME } from "@rushsite/shared";
import { MODE_PAGES } from "@/lib/seo";
import styles from "./SiteFooter.module.css";

// Plain links to the public pages, for players and crawlers
export function SiteFooter() {
  // Admin has its own shell
  if (usePathname().startsWith("/admin")) return null;
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <nav aria-label="Modes">
          <h2 className={styles.heading}>Modes</h2>
          <ul>
            {MODE_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={`/modes/${p.slug}`}>{p.heading}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Compete">
          <h2 className={styles.heading}>Compete</h2>
          <ul>
            <li>
              <Link href="/tournaments">Cups</Link>
            </li>
            <li>
              <Link href="/leaderboard">Leaderboard</Link>
            </li>
            <li>
              <Link href="/ranks">Ranks</Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Guides">
          <h2 className={styles.heading}>Guides</h2>
          <ul>
            <li>
              <Link href="/maps">Maps</Link>
            </li>
            <li>
              <Link href="/modes">All modes</Link>
            </li>
            <li>
              <Link href="/status">Server status</Link>
            </li>
          </ul>
        </nav>
        <p className={styles.note}>
          {BRAND_NAME} is a community platform for CS2. Not affiliated with Valve.
        </p>
      </div>
    </footer>
  );
}
