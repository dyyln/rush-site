"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TrustStatus } from "@/lib/trust";
import { cx } from "@/components/ui/cx";
import { readFlag, writeFlag } from "./flags";
import styles from "./ProfileNudge.module.css";

export const STEAM_PRIVACY_URL = "https://steamcommunity.com/my/edit/settings";

type NudgeId = "steam_friends" | "game_details";

const COPY: Record<NudgeId, string> = {
  steam_friends: "Make your Steam friends list public to see friends here",
  game_details: "Make game details public so account age counts toward Trusted",
};

// The api cannot read the account age while it is hidden, so it reports 0 days and not met
function accountAgeHidden(trust: TrustStatus | undefined): boolean {
  const req = trust?.requirements.find((r) => r.key === "account_age");
  return !!req && !req.met && (req.progress?.current ?? 0) === 0;
}

// Open profile gaps for the signed in player, from GET /me trust and GET /friends
export function useProfileNudges(trust: TrustStatus | undefined, enabled: boolean) {
  const [friendsPrivate, setFriendsPrivate] = useState(false);
  const [dismissed, setDismissed] = useState<Set<NudgeId>>(new Set());

  useEffect(() => {
    setDismissed(new Set((Object.keys(COPY) as NudgeId[]).filter((id) => readFlag(`nudge.${id}`))));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.friends.list().then(
      (r) => live && setFriendsPrivate(!r.steamListAvailable),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);

  const open: NudgeId[] = [];
  if (enabled && friendsPrivate) open.push("steam_friends");
  if (enabled && accountAgeHidden(trust)) open.push("game_details");

  function dismiss(id: NudgeId) {
    writeFlag(`nudge.${id}`);
    setDismissed((s) => new Set(s).add(id));
  }

  return { items: open.filter((id) => !dismissed.has(id)), dismiss };
}

type ProfileNudgeProps = {
  trust: TrustStatus | undefined;
  enabled: boolean;
  // card on the own profile, line on /play
  variant?: "card" | "line";
};

export function ProfileNudge({ trust, enabled, variant = "card" }: ProfileNudgeProps) {
  const { items, dismiss } = useProfileNudges(trust, enabled);
  if (items.length === 0) return null;
  return (
    <section className={cx(styles.nudge, styles[variant])} aria-label="Complete your profile">
      {variant === "card" && <h2 className={styles.title}>Complete your profile</h2>}
      <ul className={styles.list}>
        {items.map((id) => (
          <li key={id} className={styles.item}>
            <span className={styles.text}>{COPY[id]}</span>
            <span className={styles.actions}>
              <a href={STEAM_PRIVACY_URL} target="_blank" rel="noreferrer" className={styles.link}>
                Steam privacy settings
              </a>
              <button type="button" className={styles.dismiss} onClick={() => dismiss(id)}>
                <span className="visually-hidden">Dismiss: {COPY[id]}</span>
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
