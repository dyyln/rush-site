"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BRAND_NAME } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { useSession } from "@/lib/session";
import styles from "./SiteHeader.module.css";

const NAV = [
  { href: "/play", label: "Play" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const nav = user?.isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          {BRAND_NAME}
        </Link>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="visually-hidden">Menu</span>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <nav id="site-nav" aria-label="Main" className={`${styles.nav} ${open ? styles.navOpen : ""}`}>
          <ul>
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={styles.link}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              {user ? (
                <Link
                  href={`/profile/${user.steamId}`}
                  className={`${styles.link} ${styles.me}`}
                  aria-current={pathname === `/profile/${user.steamId}` ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
                  <span>{user.displayName}</span>
                </Link>
              ) : (
                <Link href="/login" className={`${styles.link} ${styles.signIn}`} onClick={() => setOpen(false)}>
                  Sign in
                </Link>
              )}
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
