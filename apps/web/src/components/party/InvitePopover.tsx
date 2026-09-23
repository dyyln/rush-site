"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BRAND_NAME } from "@rushsite/shared";
import { matchesQuery, PresenceAvatar, sortByPresence } from "@/components/friends/presence";
import { SearchBox } from "@/components/friends/SearchBox";
import { useFriends } from "@/components/friends/store";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { CheckIcon, CopyIcon, useCopyFeedback } from "@/components/ui/CopyButton";
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
  const feedback = useCopyFeedback();
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
    if (await actions.copyLink()) feedback.show("copied");
  }

  const [query, setQuery] = useState("");
  // Friends here first, grouped by presence. Steam friends who can only get a link come after a divider
  const all = [
    ...sortByPresence(friends.data?.friends ?? []).map((f) => ({ ...f, registered: true })),
    ...[...(friends.data?.steamOnly ?? [])]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }))
      .map((f) => ({ ...f, presence: f.personaState > 0 ? ("online" as const) : ("offline" as const), registered: false })),
  ];
  const list = all.filter((f) => matchesQuery(f, query));

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-labelledby={titleId}>
      <p id={titleId} className={styles.title}>
        Invite to party
      </p>
      <Button
        variant="secondary"
        block
        className={feedback.copied ? buttonStyles.copied : undefined}
        icon={feedback.copied ? <CheckIcon /> : <CopyIcon />}
        onClick={copy}
      >
        <span aria-live="polite">{feedback.copied ? "Copied" : "Copy invite link"}</span>
      </Button>
      {all.length > 0 && (
        <>
          <p className={styles.title}>Friends</p>
          <p className={styles.status}>{STEAM_FRIENDS_SUBTITLE}</p>
          <SearchBox value={query} onChange={setQuery} />
          {list.length === 0 && <p className={styles.status}>No friends match.</p>}
          <ul className={styles.friends}>
            {list.map((f, i) => [
              !f.registered && (i === 0 || list[i - 1]!.registered) && (
                <li key="divider" className={styles.divider} role="presentation">
                  Not on {BRAND_NAME}
                </li>
              ),
              <li key={f.steamId} className={styles.friend}>
                <PresenceAvatar name={f.displayName} src={f.avatarUrl} presence={f.presence} />
                <span className={styles.name}>{f.displayName}</span>
                <FriendAction friend={f} actions={actions} />
              </li>,
            ])}
          </ul>
        </>
      )}
    </div>
  );
}
