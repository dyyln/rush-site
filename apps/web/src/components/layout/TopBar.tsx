"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BRAND_NAME } from "@rushsite/shared";
import { Logo } from "@/components/ui/Logo";
import { SignInLink } from "@/components/ui/SignInLink";
import { startPlayStore } from "@/components/play/playStore";
import { useSession } from "@/lib/session";
import { MainMenu } from "./MainMenu";
import { PartySlots } from "./PartySlots";
import styles from "./TopBar.module.css";

// Cups and Leaderboard live beside Play as top level tabs
const TABS = [
  { href: "/play", label: "Play" },
  { href: "/tournaments", label: "Cups" },
  { href: "/leaderboard", label: "Leaderboard" },
];

// Top of every page, in place of a header bar: logo and tabs on the left, party and menu on the right
export function TopBar() {
  const pathname = usePathname();
  const { user } = useSession();

  useEffect(() => {
    if (user) startPlayStore();
  }, [user?.steamId]);

  return (
    <header className={styles.bar}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.lead}>
          <p className={styles.brand} aria-hidden="true">
            {BRAND_NAME}
          </p>
          <div className={styles.row}>
            {/* Spans the tab text's cap height down to the bottom of the underline */}
            <Link href="/" className={styles.logo} aria-label={`${BRAND_NAME} home`}>
              <Logo size={40} />
            </Link>
            <nav aria-label="Main">
              <ul className={styles.tabs}>
                {TABS.map((t) => {
                  const active = pathname === t.href || pathname.startsWith(t.href + "/");
                  return (
                    <li key={t.href}>
                      <Link href={t.href} className={styles.tab} aria-current={active ? "page" : undefined}>
                        {t.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
        <div className={styles.end}>
          {pathname === "/banned" ? null : user ? (
            <>
              <PartySlots user={user} />
              <MainMenu user={user} />
            </>
          ) : (
            <SignInLink plain className={styles.signIn}>
              Sign in
            </SignInLink>
          )}
        </div>
      </div>
    </header>
  );
}
