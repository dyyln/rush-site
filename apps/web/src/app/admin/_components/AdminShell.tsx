"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { useSession } from "@/lib/session";
import { useConnectionState } from "../_lib/live";
import styles from "../admin.module.css";
import { AdminNotFound } from "./AdminNotFound";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/queue", label: "Queue" },
  { href: "/admin/matches", label: "Matches" },
  { href: "/admin/tournaments", label: "Tournaments" },
  { href: "/admin/hosts", label: "Hosts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/maps", label: "Maps" },
  { href: "/admin/flags", label: "Flags" },
  { href: "/admin/announcements", label: "Announcements" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="container" aria-busy="true">
        <p className="muted" style={{ padding: "var(--space-6) 0" }}>
          Loading
        </p>
      </div>
    );
  }
  if (!user?.isAdmin) return <AdminNotFound />;

  return (
    <div className={cx("container", styles.shell)}>
      <aside className={styles.sidebar}>
        <div className={styles.sideTitle}>
          <p className="eyebrow">Admin</p>
          <LiveIndicator />
        </div>
        <nav aria-label="Admin" className={styles.nav}>
          <ul>
            {NAV.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} className={styles.navLink} aria-current={active ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className={styles.main}>{children}</div>
    </div>
  );
}

function LiveIndicator() {
  const state = useConnectionState();
  const label = state === "open" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  return (
    <span className={styles.live} role="status">
      <span
        className={cx(styles.dot, state === "open" ? styles.dotOk : state === "connecting" ? styles.dotWarn : styles.dotBad)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
