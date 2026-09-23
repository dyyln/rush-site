"use client";

import { useCallback, useState } from "react";
import { copyText } from "@/components/match/copy";
import { COPIED_MS } from "@/components/ui/CopyButton";
import type { PartyUpdatePayload } from "@rushsite/shared";
import { friendError } from "@/components/friends/presence";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

export type InviteSource = {
  inviteUrl: string | null;
  // Creates the party when needed and returns the invite URL
  ensureInvite: () => Promise<string | null>;
  // Receives the party after an in-site invite created or reused it
  onParty?: (party: PartyUpdatePayload) => void;
};

const linkFor = (p: PartyUpdatePayload) => (p.inviteCode ? `${window.location.origin}/invite/${p.inviteCode}` : null);

// Pages without party state look the party up, creating one when needed
async function fallbackInvite(): Promise<string | null> {
  const current = await api.party.get();
  return linkFor(current.partyId ? current : await api.party.create());
}

// In-site invite for friends, copy and paste link for Steam friends who have not signed in here
export function useFriendInvite(source: Partial<InviteSource> = {}) {
  const { inviteUrl = null, ensureInvite = fallbackInvite, onParty } = source;
  const toast = useToast();
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [linked, setLinked] = useState<Record<string, boolean>>({});

  const link = useCallback(async () => inviteUrl ?? (await ensureInvite()), [inviteUrl, ensureInvite]);

  const copyLink = useCallback(async (): Promise<string | null> => {
    try {
      const url = await link();
      if (!url) throw new Error("no link");
      if (!(await copyText(url))) throw new Error("copy failed");
      return url;
    } catch {
      toast.push({ title: "Could not copy the invite link", tone: "error" });
      return null;
    }
  }, [link, toast]);

  const invite = useCallback(
    async (steamId: string, name: string) => {
      setBusy((b) => ({ ...b, [steamId]: true }));
      try {
        const party = await api.party.inviteUser(steamId);
        onParty?.(party);
        setSent((s) => ({ ...s, [steamId]: true }));
        toast.push({ title: `Invite sent to ${name}`, tone: "success" });
      } catch (e) {
        toast.push({ title: `Could not invite ${name}`, body: friendError(e), tone: "error" });
      } finally {
        setBusy((b) => ({ ...b, [steamId]: false }));
      }
    },
    [onParty, toast],
  );

  // Steam has no invite api. Copy the link and open the chat so the player can paste it
  const sendLink = useCallback(
    async (steamId: string) => {
      if (!(await copyLink())) return;
      setLinked((l) => ({ ...l, [steamId]: true }));
      setTimeout(() => setLinked((l) => ({ ...l, [steamId]: false })), COPIED_MS);
      window.location.href = `steam://friends/message/${steamId}`;
    },
    [copyLink],
  );

  return { sent, busy, linked, invite, sendLink, copyLink };
}
