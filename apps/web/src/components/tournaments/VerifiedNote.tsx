"use client";

import Link from "next/link";
import { trustAtLeast, type TrustLevel } from "@rushsite/shared";
import { cx } from "@/components/ui/cx";
import { useSession } from "@/lib/session";
import { TRUST_NAMES, trustProgressLine } from "@/lib/trust";
import styles from "./VerifiedNote.module.css";

type VerifiedNoteProps = {
  // Level the cups need. Verified for the scheduled cups
  minTrust?: TrustLevel;
  className?: string;
};

// One line that tells players early what cups need and how far along they are
export function VerifiedNote({ minTrust = "verified", className }: VerifiedNoteProps) {
  const { user, loading } = useSession();
  if (loading || minTrust === "new") return null;
  if (user && trustAtLeast(user.trustLevel, minTrust)) return null;
  const need = TRUST_NAMES[minTrust];
  return (
    <p className={cx(styles.note, className)}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={styles.icon}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7v4.5M8 4.5v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>
        {user ? (
          <>
            Cups need a {need} account. You are {user.trust ? trustProgressLine(user.trust) : TRUST_NAMES[user.trustLevel]}.{" "}
            <Link href="/play">Play ladder matches to get there</Link>
          </>
        ) : (
          <>
            Cups need a {need} account. After you sign in, finish a few clean ladder matches on <Link href="/play">Play</Link> to get there.
          </>
        )}
      </span>
    </p>
  );
}
