"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import styles from "./InvitePopover.module.css";

type InvitePopoverProps = {
  inviteUrl: string | null;
  // Creates the party and returns the new invite URL
  ensureInvite: () => Promise<string | null>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
};

// Copy the invite link or send it to a Steam friend
export function InvitePopover({ inviteUrl, ensureInvite, onClose, returnFocus }: InvitePopoverProps) {
  const friends = useAsync(() => api.challenges.friends(), []);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const toast = useToast();
  const [sent, setSent] = useState<Record<string, boolean>>({});

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
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

  async function copyLink(): Promise<string | null> {
    setBusy(true);
    try {
      const url = inviteUrl ?? (await ensureInvite());
      if (!url) throw new Error("no link");
      await navigator.clipboard.writeText(url);
      setStatus("Invite link copied");
      return url;
    } catch {
      setStatus("Could not copy the link");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Registered players get an in-site invite
  async function inviteFriend(steamId: string, name: string) {
    try {
      await ensureParty();
      await api.party.inviteUser(steamId);
      setSent((s) => ({ ...s, [steamId]: true }));
      toast.push({ title: `Invite sent to ${name}`, tone: "success" });
    } catch {
      toast.push({ title: `Could not invite ${name}`, tone: "error" });
    }
  }

  // Steam has no invite api. Copy the link and open the chat so the player can paste it
  async function sendLink(steamId: string) {
    const url = await copyLink();
    if (!url) return;
    toast.push({ title: "Link copied, paste it in the Steam chat", tone: "info" });
    window.location.href = `steam://friends/message/${steamId}`;
  }

  async function ensureParty() {
    if (!inviteUrl) await ensureInvite();
  }

  const list = friends.data?.available
    ? [...friends.data.friends].sort((a, b) => Number(b.registered) - Number(a.registered))
    : [];

  return (
    <div ref={ref} className={styles.popover} role="dialog" aria-labelledby={titleId}>
      <p id={titleId} className={styles.title}>
        Invite to party
      </p>
      <Button variant="secondary" block onClick={copyLink} loading={busy}>
        Copy invite link
      </Button>
      {friends.status === "success" && list.length > 0 && (
        <ul className={styles.friends}>
          {list.map((f) => (
            <li key={f.steamId} className={styles.friend}>
              <Avatar name={f.displayName} src={f.avatarUrl} size="sm" status={f.personaState > 0 ? "online" : undefined} />
              <span className={styles.name}>{f.displayName}</span>
              {f.registered ? (
                <Button
                  variant="ghost"
                  onClick={() => inviteFriend(f.steamId, f.displayName)}
                  disabled={sent[f.steamId]}
                  aria-label={`Invite ${f.displayName} to party`}
                >
                  {sent[f.steamId] ? "Invited" : "Invite"}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => sendLink(f.steamId)} aria-label={`Send party link to ${f.displayName} in Steam chat`}>
                  Send link
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}
