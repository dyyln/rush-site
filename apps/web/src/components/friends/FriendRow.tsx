"use client";

import Link from "next/link";
import type { Friend, SteamOnlyFriend } from "@rushsite/shared";
import { ChallengeButton } from "@/components/challenges/ChallengeButton";
import { ButtonLink } from "@/components/ui/Button";
import { FriendAction } from "@/components/party/FriendAction";
import type { useFriendInvite } from "@/components/party/useFriendInvite";
import { PresenceAvatar, PresenceLine } from "./presence";
import type { JoinableModes } from "./useJoinQueue";
import styles from "./friends.module.css";

type Actions = ReturnType<typeof useFriendInvite>;

// A friend here with Invite, Challenge and Profile
export function FriendRow({ friend, actions, joinable }: { friend: Friend; actions: Actions; joinable?: JoinableModes }) {
  return (
    <li className={styles.row}>
      <span className={styles.who}>
        <PresenceAvatar name={friend.displayName} src={friend.avatarUrl} presence={friend.presence} />
        <span className={styles.names}>
          <Link href={`/profile/${friend.steamId}`} className={styles.name}>
            {friend.displayName}
          </Link>
          <PresenceLine presence={friend.presence} detail={friend.detail} joinable={joinable} />
        </span>
      </span>
      <span className={styles.actions}>
        <FriendAction friend={{ ...friend, registered: true }} actions={actions} />
        <ChallengeButton target={friend} variant="ghost" />
        <ButtonLink variant="ghost" href={`/profile/${friend.steamId}`} aria-label={`${friend.displayName} profile`}>
          Profile
        </ButtonLink>
      </span>
    </li>
  );
}

// A Steam friend who has not signed in. Steam online state stands in for presence
export function SteamOnlyRow({ friend, actions }: { friend: SteamOnlyFriend; actions: Actions }) {
  const presence = friend.personaState > 0 ? "online" : "offline";
  return (
    <li className={styles.row}>
      <span className={styles.who}>
        <PresenceAvatar name={friend.displayName} src={friend.avatarUrl} presence={presence} />
        <span className={styles.names}>
          <span className={styles.name}>{friend.displayName}</span>
          <span className={styles.presenceLine}>
            <span className={styles.presenceText}>{presence === "online" ? "Online on Steam" : "Not signed in here"}</span>
          </span>
        </span>
      </span>
      <span className={styles.actions}>
        <FriendAction friend={{ ...friend, registered: false }} actions={actions} />
      </span>
    </li>
  );
}
