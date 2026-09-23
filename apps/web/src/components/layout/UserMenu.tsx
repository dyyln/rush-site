"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
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
        <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
        <span>{user.displayName}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <ul id={menuId} className={styles.menu}>
          <li>
            <Link
              href={`/profile/${user.steamId}`}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              Profile
            </Link>
          </li>
          <li>
            <Link
              href="/settings"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              Settings
            </Link>
          </li>
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
