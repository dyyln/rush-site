"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { isMock } from "@/lib/env";
import { modeLabel } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { useChallengeUpdates } from "./useChallenges";
import styles from "./challenges.module.css";

// Site wide notice for incoming challenges and for your own challenge being answered
export function ChallengeInbox() {
  const { user } = useSession();
  const toast = useToast();
  const pathname = usePathname();
  const seen = useRef(new Set<string>());
  const me = user?.steamId;

  useChallengeUpdates((c) => {
    // The challenge page shows its own state
    if (!me || pathname === `/challenge/${c.code}`) return;
    const key = `${c.id}:${c.status}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    const kind = c.rematchOfMatchId ? "Rematch" : "Challenge";
    const link = (
      <span className={styles.toastActions}>
        <Link href={`/challenge/${c.code}`}>View</Link>
      </span>
    );
    if (c.status === "open" && c.createdBy.steamId !== me) {
      toast.push({
        title: `${kind} from ${c.createdBy.displayName}`,
        body: (
          <>
            {modeLabel(c.mode)}
            {link}
          </>
        ),
        durationMs: 15_000,
      });
    } else if (c.createdBy.steamId === me && c.status === "declined") {
      toast.push({ title: `${c.target?.displayName ?? "They"} declined your ${kind.toLowerCase()}`, tone: "error" });
    } else if (c.status === "accepted" && pathname !== "/play") {
      toast.push({
        title: `${kind} accepted`,
        body: (
          <>
            {modeLabel(c.mode)} is starting.
            <span className={styles.toastActions}>
              {isMock ? <Link href="/play">Go to match</Link> : <a href="/play">Go to match</a>}
            </span>
          </>
        ),
        tone: "success",
        durationMs: 20_000,
      });
    }
  }, !!me);

  return null;
}
