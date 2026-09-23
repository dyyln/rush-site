"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PresenceAvatar } from "@/components/friends/presence";
import { useFriends } from "@/components/friends/store";
import { Button } from "@/components/ui/Button";
import { FriendAction, STEAM_FRIENDS_SUBTITLE } from "./FriendAction";
import { useFriendInvite, type InviteSource } from "./useFriendInvite";
import styles from "./InvitePopover.module.css";

type InvitePopoverProps = InviteSource & {
  onClose: () => void;
  returnFocus?: HTMLElement | null;
};

// Copy the invite link or invite a Steam friend
export function InvitePopover({ inviteUrl, ensureInvite, onParty, onClose, returnFocus }: InvitePopoverProps) {
  const friends = useFriends();
  const actions = useFriendInvite({ inviteUrl, ensureInvite, onParty });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        returnFocus?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, returnFocus]);

  async function copy() {
    setBusy(true);
    setCopied(!!(await actions.copyLink()));
    setBusy(false);
  }

  // Friends not offline first, then Steam friends who can only get a link
  const list = [
    ...(friends.data?.friends ?? []).map((f) => ({ ...f, registered: true })),
    ...(friends.data?.steamOnly ?? []).map((f) => ({ ...f, registered: false, presence: f.personaState > 0 ? ("online" as const) : ("offline" as const) })),
  ];

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-labelledby={titleId}>
      <p id={titleId} className={styles.title}>
        Invite to party
      </p>
      <Button variant="secondary" block onClick={copy} loading={busy}>
        {copied ? "Link copied" : "Copy invite link"}
      </Button>
      {list.length > 0 && (
        <>
          <p className={styles.title}>Friends</p>
          <p className={styles.status}>{STEAM_FRIENDS_SUBTITLE}</p>
          <ul className={styles.friends}>
            {list.map((f) => (
              <li key={f.steamId} className={styles.friend}>
                <PresenceAvatar name={f.displayName} src={f.avatarUrl} presence={f.presence} />
                <span className={styles.name}>{f.displayName}</span>
                <FriendAction friend={f} actions={actions} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
