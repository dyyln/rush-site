"use client";

import Link from "next/link";
import { useId, type CSSProperties, type ReactNode } from "react";
import type { Friend, SteamOnlyFriend } from "@rushsite/shared";
import { ChallengeButton } from "@/components/challenges/ChallengeButton";
import { FriendAction } from "@/components/party/FriendAction";
import type { useFriendInvite } from "@/components/party/useFriendInvite";
import buttonStyles from "@/components/ui/Button.module.css";
import { cx } from "@/components/ui/cx";
import { MODE_COPY } from "@/lib/modes";
import { PresenceAvatar, PresenceLine } from "./presence";
import { joinQueueHref, type JoinableModes } from "./useJoinQueue";
import styles from "./friends.module.css";

type Actions = ReturnType<typeof useFriendInvite>;

// Line icons drawn for this row, 18px on a 20px grid
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.icon}
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const InviteIcon = () => (
  <Icon>
    <circle cx="8" cy="7" r="3" />
    <path d="M2.5 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <path d="M16 6v6M13 9h6" />
  </Icon>
);

const SentIcon = () => (
  <Icon>
    <path d="M4 10.5l4 4 8-9" />
  </Icon>
);

// Two crossing blades: a direct challenge
const ChallengeIcon = () => (
  <Icon>
    <path d="M3 3l9.5 9.5M17 3l-9.5 9.5" />
    <path d="M10.5 14.5l2 2M14.5 10.5l2 2M15.5 15.5l2 2" />
    <path d="M9.5 14.5l-2 2M5.5 10.5l-2 2M4.5 15.5l-2 2" />
  </Icon>
);

const WatchIcon = () => (
  <Icon>
    <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" />
    <circle cx="10" cy="10" r="2.5" />
  </Icon>
);

// Arrow into a bracket: step into the same queue
const JoinIcon = () => (
  <Icon>
    <path d="M12 3.5h3.5v13H12" />
    <path d="M3 10h9M8.5 6.5L12 10l-3.5 3.5" />
  </Icon>
);

// Hover and focus tooltip. The control carries the same words as its aria-label
function Tip({ children }: { children: ReactNode }) {
  return (
    <span className={styles.tip} aria-hidden="true">
      {children}
    </span>
  );
}

// Invite as an icon. Stays focusable once sent (aria-disabled) so the Invited state can be read and hovered
function InviteIconButton({ friend, actions }: { friend: Friend; actions: Actions }) {
  const done = !!actions.sent[friend.steamId];
  const busy = !!actions.busy[friend.steamId];
  const name = friend.displayName;
  const label = done ? `Invite sent to ${name}` : busy ? `Inviting ${name}` : `Invite ${name} to party`;
  return (
    <button
      type="button"
      className={cx(styles.iconButton, done && styles.iconDone)}
      aria-label={label}
      aria-disabled={done || busy || undefined}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!done && !busy) actions.invite(friend.steamId, name);
      }}
    >
      {busy ? <span className={buttonStyles.spinner} aria-hidden="true" /> : done ? <SentIcon /> : <InviteIcon />}
      <Tip>{done ? "Invited" : busy ? "Inviting…" : "Invite to party"}</Tip>
    </button>
  );
}

// A friend here: avatar and name link to the profile, the status line sits under the name. Invite, Challenge
// and Watch or Join queue sit at the right of the row, vertically centred. With a mouse they are hidden until
// the row is hovered or anything in it has focus, when the status line fades out and they fade in. Touch
// screens keep both visible
export function FriendRow({ friend, actions, joinable }: { friend: Friend; actions: Actions; joinable?: JoinableModes }) {
  const { displayName: name, presence, detail } = friend;
  const statusId = useId();
  const watchId = presence === "match" ? detail?.matchId : undefined;
  const join = presence === "queue" && detail?.modes?.length ? (joinable?.(detail.modes) ?? []) : [];
  const joinLabels = join.map((m) => MODE_COPY[m].label).join(", ");
  // The dot's hidden label repeats the status line, except in a match where the line shows mode and map
  const dotLabelled = presence === "match" && !!detail?.mode;
  // How many icons show, so the name can make room for them while they are visible
  const iconCount = 2 + (watchId ? 1 : 0) + (join.length > 0 ? 1 : 0);

  return (
    <li className={cx(styles.row, styles.compactRow)} style={{ "--icon-count": iconCount } as CSSProperties}>
      <Link href={`/profile/${friend.steamId}`} className={styles.profileLink} aria-describedby={statusId}>
        <PresenceAvatar name={name} src={friend.avatarUrl} presence={presence} labelled={dotLabelled} />
        <span className={styles.name}>{name}</span>
      </Link>
      <span id={statusId} className={styles.status}>
        <PresenceLine presence={presence} detail={detail} />
      </span>
      <span className={styles.iconActions}>
        {watchId && (
          <Link href={`/matches/${watchId}`} className={styles.iconButton} aria-label={`Watch ${name}'s match`}>
            <WatchIcon />
            <Tip>Watch match</Tip>
          </Link>
        )}
        {join.length > 0 && (
          <Link href={joinQueueHref(join)} className={styles.iconButton} aria-label={`Join queue for ${joinLabels}`}>
            <JoinIcon />
            <Tip>Join queue: {joinLabels}</Tip>
          </Link>
        )}
        <InviteIconButton friend={friend} actions={actions} />
        <ChallengeButton
          target={friend}
          trigger={(open) => (
            <button type="button" className={styles.iconButton} onClick={open} aria-haspopup="dialog" aria-label={`Challenge ${name}`}>
              <ChallengeIcon />
              <Tip>Challenge</Tip>
            </button>
          )}
        />
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
