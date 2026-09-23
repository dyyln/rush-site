"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { mmss } from "@/lib/format";
import { useSession } from "@/lib/session";
import { queuedSince, startPlayStore, useGlobalPlay } from "./playStore";
import { useNow } from "./useNow";
import { useTabTitle } from "./useTabTitle";
import styles from "./QueuePill.module.css";

// Header pill for a running queue or a match waiting on the player. Also drives the tab title
export function QueuePill() {
  const { user } = useSession();
  const pathname = usePathname();
  const play = useGlobalPlay();

  useEffect(() => {
    if (user) startPlayStore();
  }, [user?.steamId]);

  useTabTitle(user ? play : { queue: null, match: null });

  const since = queuedSince(play.queue);
  const now = useNow(since !== null || play.match?.phase === "found", 1000);
  if (!user || pathname === "/play" || pathname.startsWith("/play/")) return null;

  const match = play.match;
  const matchLive = match && (match.phase !== "found" || (now !== null && match.deadline > now));
  if (matchLive) {
    return (
      <Link href="/play" className={`${styles.pill} ${styles.ready}`}>
        <span className={styles.dot} aria-hidden="true" />
        Match ready
      </Link>
    );
  }
  if (since === null) return null;
  return (
    <Link href="/play" className={styles.pill} aria-label={`In queue for ${now === null ? "a moment" : mmss((now - since) / 1000)}. Go to Play`}>
      <span className={styles.dot} aria-hidden="true" />
      In queue <span className="mono">{now === null ? "--:--" : mmss((now - since) / 1000)}</span>
    </Link>
  );
}
