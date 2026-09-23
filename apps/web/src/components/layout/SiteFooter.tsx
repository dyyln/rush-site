import Link from "next/link";
import { BRAND_NAME } from "@rushsite/shared";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.brand}>{BRAND_NAME}. Competitive for CS2.</p>
        <nav aria-label="Footer">
          <ul className={styles.links}>
            <li>
              <Link href="/status">Server status</Link>
            </li>
            <li>
              <Link href="/leaderboard">Leaderboard</Link>
            </li>
            <li>
              <Link href="/tournaments">Tournaments</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
