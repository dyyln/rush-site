"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { useSession } from "@/lib/session";
import { adminApi } from "../_lib/client";
import { ago, stamp } from "../_lib/format";
import { useConnectionState } from "../_lib/live";
import type { BuildInfo } from "../_lib/types";
import styles from "../admin.module.css";
import { AdminNotFound } from "./AdminNotFound";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/queue", label: "Queue" },
  { href: "/admin/matches", label: "Matches" },
  { href: "/admin/tournaments", label: "Tournaments" },
  { href: "/admin/hosts", label: "Hosts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/maps", label: "Maps" },
  { href: "/admin/flags", label: "Flags" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/admins", label: "Admins" },
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
        <BuildStamp />
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

const REPO_URL = "https://github.com/dyyln/rush-site";

// Whole minutes, since the stamp only re-renders once a minute
function builtAgo(iso: string, now: number): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return ago(iso, now);
}

// The commit the live API was built from, so it is easy to tell what is deployed
function BuildStamp() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    adminApi
      .build()
      .then((b) => alive && setBuild(b))
      .catch(() => alive && setBuild({ sha: null, subject: null, builtAt: null }));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!build) return null;
  return (
    <div className={styles.build}>
      <p className={styles.buildLabel}>Deployed</p>
      {build.sha ? (
        <>
          <a
            href={`${REPO_URL}/commit/${build.sha}`}
            target="_blank"
            rel="noreferrer"
            className={cx("mono", styles.buildSha)}
            title={build.subject ?? undefined}
          >
            {build.sha.slice(0, 7)}
          </a>
          {build.subject && <p className={styles.buildSubject}>{build.subject}</p>}
          {build.builtAt && (
            <p className={styles.buildTime}>
              <time dateTime={build.builtAt} title={stamp(build.builtAt)}>
                Built {builtAgo(build.builtAt, now)}
              </time>
            </p>
          )}
        </>
      ) : (
        <p className={styles.buildSubject}>Unknown, not a deployed build</p>
      )}
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
