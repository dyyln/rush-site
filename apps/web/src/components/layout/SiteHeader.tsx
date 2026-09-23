"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BRAND_NAME } from "@rushsite/shared";
import { SignInLink } from "@/components/ui/SignInLink";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/lib/session";
import { UserMenu } from "./UserMenu";
import { QueuePill } from "@/components/play/QueuePill";
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

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          <Logo size={28} className={styles.mark} />
          {BRAND_NAME}
        </Link>
        <QueuePill />
        <nav id="site-nav" aria-label="Main" className={`${styles.nav} ${open ? styles.navOpen : ""}`}>
          <ul>
            {NAV.map((item) => {
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
          </ul>
        </nav>
        <div className={styles.end}>
          {pathname === "/banned" ? null : user ? (
            <UserMenu user={user} onNavigate={() => setOpen(false)} />
          ) : (
            <SignInLink plain className={`${styles.link} ${styles.signIn}`} onClick={() => setOpen(false)}>
              Sign in
            </SignInLink>
          )}
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
        </div>
      </div>
    </header>
  );
}
