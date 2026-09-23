"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { friendError } from "./presence";
import { reloadFriends, reloadPending, useFriends } from "./store";
import styles from "./friends.module.css";

// Add friend on another player's profile. Follows the request through to Friends
export function FriendButton({ target }: { target: { steamId: string; displayName: string } }) {
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
    return (
      <Button variant="secondary" loading={busy} onClick={() => run(() => api.friends.cancel(outgoing.id))} aria-label={`Request sent to ${target.displayName}. Cancel request`}>
        Requested
      </Button>
    );
  }
  return (
    <Button variant="secondary" loading={busy} onClick={() => run(() => api.friends.add(target.steamId), `Friend request sent to ${target.displayName}`)}>
      Add friend
    </Button>
  );
}
