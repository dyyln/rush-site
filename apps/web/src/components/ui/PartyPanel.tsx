"use client";

import { useRef, useState, type ReactNode } from "react";
import type { PartyUpdatePayload } from "@rushsite/shared";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { PartySize } from "./PartySize";
import styles from "./PartyPanel.module.css";

type Me = { steamId: string; displayName: string; avatarUrl: string | null };

type PartyPanelProps = {
  party: PartyUpdatePayload | null;
  mySteamId: string;
  // Shown as a party of one when the api reports no party yet
  me?: Me;
  // Largest team size across modes, which caps the party
  maxSize?: number;
  // Full invite URL. Built by the page from the invite code
  inviteUrl?: string | null;
  onCreate?: () => void | Promise<void>;
  onLeave?: () => void;
  onKick?: (steamId: string) => void;
  // Locks changes while queued or in a match
  locked?: boolean;
  steamFriendsUrl?: string;
  // Renders the invite popover for an empty slot
  renderInvite?: (close: () => void, anchor: HTMLElement | null) => ReactNode;
};

export function PartyPanel({ party, mySteamId, me, maxSize = 3, inviteUrl, onCreate, onLeave, onKick, locked, steamFriendsUrl, renderInvite }: PartyPanelProps) {
  const [copied, setCopied] = useState(false);
  const [inviteSlot, setInviteSlot] = useState<number | null>(null);
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [creating, setCreating] = useState(false);
  // No party yet means a party of one led by the viewer
  const solo = !party?.partyId || (party.members.length === 0 && !!me);
  const members = party && party.members.length > 0 ? party.members : me ? [me] : [];
  const leaderSteamId = party?.leaderSteamId ?? (solo ? mySteamId : null);
  const isLeader = leaderSteamId === mySteamId;
  const open = Math.max(0, maxSize - Math.max(members.length, 1));

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card
      title="Party"
      eyebrow={
        <PartySize
          count={Math.max(members.length, 1)}
          capacity={maxSize}
          label={`${Math.max(members.length, 1)} of ${maxSize} players`}
        />
      }
      actions={
        party?.partyId && onLeave ? (
          <Button variant="ghost" onClick={onLeave} disabled={locked}>
            Leave
          </Button>
        ) : null
      }
    >
      <ul className={styles.members}>
        {members.map((m) => (
          <li key={m.steamId} className={styles.member}>
            <Avatar name={m.displayName} src={m.avatarUrl} status="online" />
            <span className={styles.name}>
              {m.displayName}
              {m.steamId === mySteamId && <span className="muted"> (you)</span>}
            </span>
            {m.steamId === leaderSteamId && <Badge tone="accent">Leader</Badge>}
            {isLeader && m.steamId !== mySteamId && onKick && (
              <Button variant="ghost" onClick={() => onKick(m.steamId)} disabled={locked} aria-label={`Remove ${m.displayName}`}>
                Remove
              </Button>
            )}
          </li>
        ))}
        {Array.from({ length: open }, (_, i) => (
          <li key={`open${i}`} className={styles.openItem}>
            {renderInvite ? (
              <button
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
                type="button"
                className={`${styles.member} ${styles.open} ${styles.slotButton}`}
                aria-label="Invite to party"
                aria-expanded={inviteSlot === i}
                aria-haspopup="dialog"
                disabled={locked}
                onClick={() => setInviteSlot((v) => (v === i ? null : i))}
              >
                <SlotIcon />
                <span className="muted">Open slot</span>
              </button>
            ) : (
              <span className={`${styles.member} ${styles.open}`}>
                <SlotIcon />
                <span className="muted">Open slot</span>
              </span>
            )}
            {renderInvite && inviteSlot === i && renderInvite(() => setInviteSlot(null), slotRefs.current[i] ?? null)}
          </li>
        ))}
      </ul>

      <div className={styles.invite}>
        <label className={styles.inviteLabel} htmlFor="party-invite">
          Invite link
        </label>
        <div className={styles.inviteRow}>
          <input
            id="party-invite"
            className={`${styles.inviteInput} mono`}
            value={inviteUrl ?? ""}
            placeholder="No link yet"
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          {inviteUrl ? (
            <Button variant="secondary" onClick={copy} disabled={locked}>
              {copied ? "Copied" : "Copy"}
            </Button>
          ) : (
            onCreate && (
              <Button
                variant="secondary"
                loading={creating}
                disabled={locked}
                onClick={async () => {
                  setCreating(true);
                  try {
                    await onCreate();
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                Create
              </Button>
            )
          )}
        </div>
        <p className={styles.live} aria-live="polite">
          {copied ? "Invite link copied" : ""}
        </p>
        {steamFriendsUrl && (
          <a className={styles.friends} href={steamFriendsUrl} target="_blank" rel="noreferrer">
            Invite from Steam friends
          </a>
        )}
      </div>
    </Card>
  );
}

function SlotIcon() {
  return (
    <span className={styles.slot} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="8" cy="6" r="3.2" fill="currentColor" />
        <path d="M1.5 18c0-3.7 2.9-6.2 6.5-6.2s6.5 2.5 6.5 6.2z" fill="currentColor" />
        <path d="M16 2.5v6M13 5.5h6" stroke="var(--color-text)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
