"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PartyInvite } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import { useSession } from "@/lib/session";
import { getRealtime } from "@/lib/ws";
import { mockScheduleIncomingInvite } from "./mock";
import { friendError } from "./presence";
import { forgetInvite, usePending } from "./store";
import styles from "./friends.module.css";

function InviteActions({ invite, onDone }: { invite: PartyInvite; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  async function accept() {
    setBusy("accept");
    try {
      await api.friends.acceptInvite(invite.id);
      forgetInvite(invite.id);
      onDone();
      toast.push({ title: `Joined ${invite.from.displayName}'s party`, tone: "success" });
      router.push("/play");
    } catch (e) {
      forgetInvite(invite.id);
      onDone();
      toast.push({ title: "Could not join the party", body: friendError(e), tone: "error" });
    }
  }

  async function decline() {
    setBusy("decline");
    try {
      await api.friends.declineInvite(invite.id);
    } catch {
      // Already answered or expired. Either way it is gone
    }
    forgetInvite(invite.id);
    onDone();
  }

  return (
    <span className={styles.toastActions}>
      <Button onClick={accept} loading={busy === "accept"} disabled={!!busy}>
        Accept
      </Button>
      <Button variant="ghost" onClick={decline} loading={busy === "decline"} disabled={!!busy}>
        Decline
      </Button>
    </span>
  );
}

// Site wide toast for party invites from friends. Accept joins the party and goes to /play
export function InviteInbox() {
  const { user } = useSession();
  const toast = useToast();
  const shown = useRef(new Map<string, number>());
  const signedIn = !!user;
  usePending(signedIn);

  useEffect(() => {
    if (!signedIn) return;
    const rt = getRealtime();
    rt.connect();
    const off = rt.on("party_invite", ({ invite }) => {
      const open = (invite.status ?? "pending") === "pending" && Date.parse(invite.expiresAt) > Date.now();
      const existing = shown.current.get(invite.id);
      if (!open) {
        // Answered in another tab or expired
        if (existing !== undefined) toast.dismiss(existing);
        shown.current.delete(invite.id);
        return;
      }
      if (existing !== undefined) return;
      const close = () => {
        const id = shown.current.get(invite.id);
        if (id !== undefined) toast.dismiss(id);
      };
      const id = toast.push({
        title: `${invite.from.displayName} invited you to their party`,
        body: <InviteActions invite={invite} onDone={close} />,
        durationMs: Math.max(5000, Math.min(60_000, Date.parse(invite.expiresAt) - Date.now())),
      });
      shown.current.set(invite.id, id);
    });
    const cancelMock = isMock ? mockScheduleIncomingInvite() : undefined;
    return () => {
      off();
      cancelMock?.();
    };
  }, [signedIn, toast]);

  return null;
}
