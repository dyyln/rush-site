"use client";

import Link from "next/link";
import { useState } from "react";
import { STEAM_FRIENDS_SUBTITLE } from "@/components/party/FriendAction";
import { useFriendInvite, type InviteSource } from "@/components/party/useFriendInvite";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FriendRow, SteamOnlyRow } from "./FriendRow";
import { usePending, useFriends } from "./store";
import styles from "./friends.module.css";

const SHOWN = 6;

// Friends under the party panel on /play. Friends first by presence, then Steam friends to send a link to
export function FriendsCard(invite: Partial<InviteSource>) {
  const { data, error } = useFriends();
  const { data: pending } = usePending();
  const actions = useFriendInvite(invite);
  const [all, setAll] = useState(false);

  const friends = data?.friends ?? [];
  const steamOnly = data?.steamOnly ?? [];
  const total = friends.length + steamOnly.length;
  const limit = all ? Infinity : SHOWN;
  const shownFriends = friends.slice(0, limit);
  const shownSteam = steamOnly.slice(0, Math.max(0, limit - shownFriends.length));
  const requests = pending?.requests ?? 0;

  return (
    <Card
      title="Friends"
      actions={
        <Link href="/friends" className={styles.watch}>
          {requests > 0 ? `${requests} request${requests === 1 ? "" : "s"}` : "All friends"}
        </Link>
      }
    >
      <p className={`muted ${styles.subtitle}`}>{STEAM_FRIENDS_SUBTITLE}</p>
      {!data && !error ? (
        <p className={styles.empty}>Loading friends…</p>
      ) : error && !data ? (
        <p className={styles.error}>Could not load friends.</p>
      ) : total === 0 ? (
        <p className={styles.empty}>
          {data?.steamListAvailable ? "No friends here yet. " : "Your Steam friends list is private or unavailable. "}
          <Link href="/friends">Add friends</Link>
        </p>
      ) : (
        <ul className={styles.list}>
          {shownFriends.map((f) => (
            <FriendRow key={f.steamId} friend={f} actions={actions} />
          ))}
          {shownSteam.map((f) => (
            <SteamOnlyRow key={f.steamId} friend={f} actions={actions} />
          ))}
        </ul>
      )}
      {total > SHOWN && (
        <Button variant="ghost" block onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${total}`}
        </Button>
      )}
    </Card>
  );
}
