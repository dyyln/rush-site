"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { usePending } from "./store";
import styles from "./friends.module.css";

// Header link to /friends with a count of pending requests and party invites
export function FriendsNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useSession();
  const pathname = usePathname();
  const { count } = usePending(!!user);
  if (!user) return null;
  const label = count > 0 ? `Friends, ${count} pending` : "Friends";
  return (
    <Link
      href="/friends"
      className={styles.navLink}
      aria-current={pathname === "/friends" ? "page" : undefined}
      aria-label={label}
      onClick={onNavigate}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5M13 3.3a3 3 0 0 1 0 5.4m2.5 3.6c1.2.7 2 1.9 2 3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.navText}>Friends</span>
      {count > 0 && (
        <span className={styles.navBadge} aria-hidden="true">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

// Pending count on the mobile menu button so it shows while the menu is closed
export function FriendsMenuBadge() {
  const { user } = useSession();
  const { count } = usePending(!!user);
  if (!user || count === 0) return null;
  return (
    <span className={`${styles.navBadge} ${styles.menuBadge}`}>
      {count > 9 ? "9+" : count}
      <span className="visually-hidden"> pending friend requests and invites</span>
    </span>
  );
}
