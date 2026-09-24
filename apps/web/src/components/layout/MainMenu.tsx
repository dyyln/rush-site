"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePending } from "@/components/friends/store";
import { TrustChip } from "@/components/trust/TrustChip";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import styles from "./TopBar.module.css";

// The three line button at the top right: account pages, admin and sign out
export function MainMenu({ user }: { user: User }) {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { count } = usePending(true);
  const badge = count > 9 ? "9+" : String(count);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function doSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/");
    }
  }

  const links: { href: string; label: string; count?: number }[] = [
    { href: `/profile/${user.steamId}`, label: "Profile" },
    { href: "/friends", label: "Friends", count },
    { href: "/ranks", label: "Ranks" },
    { href: "/settings", label: "Settings" },
    ...(user.isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <button ref={button} type="button" className={styles.burger} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)}>
        <span className="visually-hidden">Menu{count > 0 ? `, ${count} pending friend requests and invites` : ""}</span>
        <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {count > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          <div className={styles.menuHead}>
            <strong>{user.displayName}</strong>
            {user.trust && <TrustChip trust={user.trust} />}
          </div>
          <ul>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={styles.menuItem} onClick={() => setOpen(false)}>
                  {l.label}
                  {l.count ? (
                    <span className={styles.menuCount}>
                      {badge}
                      <span className="visually-hidden"> pending</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
            <li className={styles.menuRule} aria-hidden="true" />
            <li>
              <button type="button" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={doSignOut} disabled={busy}>
                {busy ? "Signing out" : "Sign out"}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
