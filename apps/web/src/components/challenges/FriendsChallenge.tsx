"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ChallengeButton } from "./ChallengeButton";
import styles from "./challenges.module.css";

const SHOWN = 6;

// Registered Steam friends with a Challenge button. Sits under the party panel on /play
export function FriendsChallenge() {
  const data = useAsync(() => api.challenges.friends(), []);
  const [all, setAll] = useState(false);

  if (data.status === "loading") return null;
  const available = data.status === "success" && data.data.available;
  const friends = available ? data.data!.friends.filter((f) => f.registered) : [];
  if (friends.length === 0) {
    const reason = data.status === "success" ? data.data.reason : undefined;
    return (
      <Card title="Friends" eyebrow="Challenge a friend">
        <p className="muted">
          {reason === "friends_private"
            ? "Your Steam friends list is private."
            : !available
              ? "Friends list unavailable."
              : "None of your Steam friends play here yet."}
        </p>
        <a className={styles.steamLink} href="steam://open/friends">
          Invite from Steam friends
        </a>
      </Card>
    );
  }
  const shown = all ? friends : friends.slice(0, SHOWN);

  return (
    <Card title="Friends" eyebrow="Challenge a friend">
      <ul className={styles.friends}>
        {shown.map((f) => (
          <li key={f.steamId} className={styles.friend}>
            <Avatar name={f.displayName} src={f.avatarUrl} size="sm" status={f.personaState > 0 ? "online" : undefined} />
            <span className={styles.friendName}>
              <Link href={`/profile/${f.steamId}`}>{f.displayName}</Link>
              {f.inGame && <span className="muted"> in game</span>}
            </span>
            <ChallengeButton target={f} variant="ghost" />
          </li>
        ))}
      </ul>
      {friends.length > SHOWN && (
        <Button variant="ghost" block onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${friends.length}`}
        </Button>
      )}
    </Card>
  );
}
