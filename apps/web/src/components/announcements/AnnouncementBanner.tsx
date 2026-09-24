"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Announcement, Mode, ServiceStatus } from "@rushsite/shared";
import { useServiceStatus } from "@/components/stats/useServiceStatus";
import { MODE_COPY } from "@/lib/modes";
import { WarningIcon } from "@/components/stats/WarningIcon";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import styles from "./AnnouncementBanner.module.css";

const DISMISSED_KEY = "announcements.dismissed";
const REFRESH_MS = 5 * 60_000;
// Keeps the stored list short. Old ids fall off the front
const MAX_REMEMBERED = 50;

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    // Storage blocked. The banner stays hidden until the page reloads
  }
}

const MOCK: Announcement[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    text: "3v3 Rush is live. Queue up and tell us how the rooms feel.",
    level: "info",
    startsAt: "2026-09-22T00:00:00.000Z",
    endsAt: null,
    dismissible: true,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  },
];

async function load(): Promise<Announcement[]> {
  if (isMock) return MOCK;
  return (await api.get<{ announcements: Announcement[] }>("/announcements")).announcements;
}

// Words that name each mode in announcement text
const MODE_WORDS: Record<Mode, RegExp> = {
  aim1v1: /\b1\s*v\s*1\b/i,
  aim2v2: /\b2\s*v\s*2\b/i,
  rush3v3: /\b(3\s*v\s*3|rush)\b/i,
  rush1v1: /\b(rush\s*1\s*v\s*1|1\s*v\s*1\s*rush)\b/i,
  rush2v2: /\b(rush\s*2\s*v\s*2|2\s*v\s*2\s*rush)\b/i,
};

function availabilityPhrase(reason?: string): string {
  if (reason === "not_configured") return "is not open yet";
  if (reason === "no_servers") return "has no servers online right now";
  if (reason === "servers_updating") return "is paused while servers update";
  if (reason === "closed") return "is closed for now";
  return "cannot be queued right now";
}

// Modes the text names that cannot queue right now
function blockedModes(text: string, status: ServiceStatus | null) {
  if (!status) return [];
  return status.modes.filter((m) => !m.available && m.reason !== "disabled" && MODE_WORDS[m.mode].test(text));
}

// Site wide notices from GET /announcements. Dismissal is remembered per announcement id
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const status = useServiceStatus();

  const refresh = useCallback(() => {
    load().then(setItems, () => undefined);
  }, []);

  useEffect(() => {
    setDismissed(readDismissed());
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!dismissed) return null;
  const now = Date.now();
  const visible = items.filter(
    (a) =>
      !(a.dismissible && dismissed.includes(a.id)) &&
      Date.parse(a.startsAt) <= now &&
      (!a.endsAt || Date.parse(a.endsAt) > now),
  );
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    const next = [...(dismissed ?? []).filter((x) => x !== id), id];
    setDismissed(next);
    writeDismissed(next);
  }

  return (
    <div className={styles.stack}>
      {visible.map((a) => (
        <section key={a.id} className={`${styles.banner} ${a.level === "warn" ? styles.warn : styles.info}`} aria-label="Announcement">
          <div className={`container ${styles.inner}`}>
            {a.level === "warn" ? <WarningIcon className={styles.icon} /> : <InfoIcon />}
            <div className={styles.text}>
              <p className={styles.line}>{a.text}</p>
              {blockedModes(a.text, status).map((m) => (
                <p key={m.mode} className={styles.availability}>
                  {MODE_COPY[m.mode].label} {availabilityPhrase(m.reason)}.{" "}
                  <Link href="/status">Server status</Link>
                </p>
              ))}
            </div>
            {a.dismissible && (
              <button type="button" className={styles.close} onClick={() => dismiss(a.id)} aria-label="Dismiss announcement">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className={styles.icon} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="4.8" r="0.95" fill="currentColor" />
    </svg>
  );
}
