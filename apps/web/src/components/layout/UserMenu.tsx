"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePending } from "@/components/friends/store";
import { TrustChip } from "@/components/trust/TrustChip";
import { Avatar } from "@/components/ui/Avatar";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import styles from "./SiteHeader.module.css";

export function UserMenu({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
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
    <div className={styles.userMenu} ref={wrap}>
      <button
        ref={button}
        type="button"
        className={`${styles.link} ${styles.me}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatarWrap}>
          <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
          {count > 0 && (
            <span className={styles.badge} aria-hidden="true">
              {badge}
            </span>
          )}
        </span>
        <span className={styles.meName}>{user.displayName}</span>
        {count > 0 && <span className="visually-hidden">, {count} pending friend requests and invites</span>}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <ul id={menuId} className={styles.menu}>
          {user.trust && (
            <li className={styles.menuTrust}>
              <TrustChip trust={user.trust} />
            </li>
          )}
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
              >
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
          <li>
            <button type="button" className={styles.menuItem} onClick={doSignOut} disabled={busy}>
              {busy ? "Signing out" : "Sign out"}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
