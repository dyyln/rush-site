"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { friendError } from "./presence";
import { reloadFriends, reloadPending, useFriends } from "./store";
import styles from "./friends.module.css";

// Add friend on another player's profile. Follows the request through to Friends
// iconClassName: show the add, requested and friends states as icon buttons with this class
export function FriendButton({ target, iconClassName }: { target: { steamId: string; displayName: string }; iconClassName?: string }) {
  const { user } = useSession();
  const self = !user || user.steamId === target.steamId;
  const { data } = useFriends(!self);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (self || !data) return null;
  const friend = data.friends.some((f) => f.steamId === target.steamId);
  const incoming = data.incoming.find((r) => r.from.steamId === target.steamId);
  const outgoing = data.outgoing.find((r) => r.to.steamId === target.steamId);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.push({ title: done, tone: "success" });
    } catch (e) {
      toast.push({ title: "Could not update friends", body: friendError(e), tone: "error" });
    }
    await Promise.all([reloadFriends(), reloadPending()]);
    setBusy(false);
    setConfirm(false);
  }

  if (friend) {
    return (
      <span className={styles.profileActions}>
        {confirm ? (
          <>
            <Button variant="danger" loading={busy} onClick={() => run(() => api.friends.remove(target.steamId))}>
              Remove friend
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </>
        ) : iconClassName ? (
          <IconAction className={iconClassName} label={`Friends with ${target.displayName}. Remove friend`} onClick={() => setConfirm(true)} done>
            <path d="M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
            <path d="M13.5 9l2 2 3.5-4" />
          </IconAction>
        ) : (
          <Button variant="secondary" onClick={() => setConfirm(true)} aria-label={`Friends with ${target.displayName}. Remove friend`}>
            Friends
          </Button>
        )}
      </span>
    );
  }
  if (incoming) {
    return (
      <span className={styles.profileActions}>
        <Button loading={busy} onClick={() => run(() => api.friends.accept(incoming.id), `You and ${target.displayName} are now friends`)}>
          Accept request
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(() => api.friends.decline(incoming.id))}>
          Decline
        </Button>
      </span>
    );
  }
  if (outgoing) {
    if (iconClassName)
      return (
        <IconAction
          className={iconClassName}
          label={`Request sent to ${target.displayName}. Cancel request`}
          onClick={() => run(() => api.friends.cancel(outgoing.id))}
          busy={busy}
          done
        >
          <path d="M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
          <circle cx="16" cy="9" r="3" />
          <path d="M16 7.5V9l1 .8" />
        </IconAction>
      );
    return (
      <Button
        variant="secondary"
        loading={busy}
        onClick={() => run(() => api.friends.cancel(outgoing.id))}
        aria-label={`Request sent to ${target.displayName}. Cancel request`}
      >
        Requested
      </Button>
    );
  }
  if (iconClassName)
    return (
      <IconAction
        className={iconClassName}
        label={`Add ${target.displayName} as a friend`}
        onClick={() => run(() => api.friends.add(target.steamId), `Friend request sent to ${target.displayName}`)}
        busy={busy}
      >
        <path d="M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
        <path d="M16 6v6M13 9h6" />
      </IconAction>
    );
  return (
    <Button variant="secondary" loading={busy} onClick={() => run(() => api.friends.add(target.steamId), `Friend request sent to ${target.displayName}`)}>
      Add friend
    </Button>
  );
}

function IconAction({
  className,
  label,
  onClick,
  busy,
  done,
  children,
}: {
  className: string;
  label: string;
  onClick: () => void;
  busy?: boolean;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className={className} onClick={onClick} disabled={busy} aria-busy={busy || undefined} title={label} data-done={done || undefined}>
      <svg
        width="20"
        height="20"
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
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
