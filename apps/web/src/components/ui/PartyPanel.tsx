"use client";

import { useState } from "react";
import type { PartyUpdatePayload } from "@rushsite/shared";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import styles from "./PartyPanel.module.css";

type PartyPanelProps = {
  party: PartyUpdatePayload | null;
  mySteamId: string;
  // Largest team size across modes, which caps the party
  maxSize?: number;
  // Full invite URL. Built by the page from the invite code
  inviteUrl?: string | null;
  onCreate?: () => void;
  onLeave?: () => void;
  onKick?: (steamId: string) => void;
  // Locks changes while queued or in a match
  locked?: boolean;
  steamFriendsUrl?: string;
};

export function PartyPanel({ party, mySteamId, maxSize = 3, inviteUrl, onCreate, onLeave, onKick, locked, steamFriendsUrl }: PartyPanelProps) {
  const [copied, setCopied] = useState(false);
  const members = party?.members ?? [];
  const isLeader = party?.leaderSteamId === mySteamId;
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
      eyebrow={`${Math.max(members.length, 1)} of ${maxSize}`}
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
            {m.steamId === party?.leaderSteamId && <Badge tone="accent">Leader</Badge>}
            {isLeader && m.steamId !== mySteamId && onKick && (
              <Button variant="ghost" onClick={() => onKick(m.steamId)} disabled={locked} aria-label={`Remove ${m.displayName}`}>
                Remove
              </Button>
            )}
          </li>
        ))}
        {Array.from({ length: open }, (_, i) => (
          <li key={`open${i}`} className={`${styles.member} ${styles.open}`}>
            <span className={styles.slot} aria-hidden="true">
              +
            </span>
            <span className="muted">Open slot</span>
          </li>
        ))}
      </ul>

      <div className={styles.invite}>
        {inviteUrl ? (
          <>
            <label className={styles.inviteLabel} htmlFor="party-invite">
              Invite link
            </label>
            <div className={styles.inviteRow}>
              <input id="party-invite" className={`${styles.inviteInput} mono`} value={inviteUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" onClick={copy} disabled={locked}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className={styles.live} aria-live="polite">
              {copied ? "Invite link copied" : ""}
            </p>
          </>
        ) : (
          onCreate && (
            <Button variant="secondary" block onClick={onCreate} disabled={locked}>
              Create invite link
            </Button>
          )
        )}
        {steamFriendsUrl && (
          <a className={styles.friends} href={steamFriendsUrl} target="_blank" rel="noreferrer">
            Invite from Steam friends
          </a>
        )}
      </div>
    </Card>
  );
}
