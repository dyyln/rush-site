"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MODE_CONFIGS, MODES, type PartyMember } from "@rushsite/shared";
import { PRESENCE_LABEL } from "@/components/friends/presence";
import { InvitePopover } from "@/components/party/InvitePopover";
import { setGlobalParty, useGlobalPlay } from "@/components/play/playStore";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { ApiError, api } from "@/lib/api";
import { describeError, knownError } from "@/lib/errors";
import type { User } from "@/lib/types";
import styles from "./TopBar.module.css";

const MAX_PARTY = Math.max(...MODES.map((m) => MODE_CONFIGS[m].teamSize));

type Slot = Pick<PartyMember, "steamId" | "displayName" | "avatarUrl" | "presence">;

// The party as avatar slots at the top right. Your own slot is always last.
// Each slot opens a menu: profile for everyone, promote and kick for the leader, leave for yourself
export function PartySlots({ user }: { user: User }) {
  const { party, queue, match } = useGlobalPlay();
  const toast = useToast();
  // "invite" or the steamId whose menu is open
  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open || open === "invite") return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const me: Slot = { steamId: user.steamId, displayName: user.displayName, avatarUrl: user.avatarUrl, presence: "online" };
  const members: Slot[] = party?.members.length ? party.members : [me];
  const ordered = [...members.filter((m) => m.steamId !== user.steamId), ...members.filter((m) => m.steamId === user.steamId)];
  const leaderId = party?.leaderSteamId ?? user.steamId;
  const iLead = leaderId === user.steamId;
  // Party changes are refused while queued or in a match
  const locked = queue?.state === "queued" || !!match;
  const inviteUrl = party?.inviteCode && origin ? `${origin}/invite/${party.inviteCode}` : null;

  async function ensureInvite(): Promise<string | null> {
    const p = await api.party.create();
    setGlobalParty(p);
    return p.inviteCode ? `${window.location.origin}/invite/${p.inviteCode}` : null;
  }

  function fail(e: unknown, title: string) {
    const known = e instanceof ApiError && knownError(e.code);
    const copy = describeError(e, { title, body: "Try again in a moment." });
    toast.push({ title: known ? copy.title : title, body: copy.body, tone: "error" });
  }

  async function kick(id: string) {
    close();
    try {
      await api.party.kick(id);
      setGlobalParty((p) => p && { ...p, members: p.members.filter((m) => m.steamId !== id) });
    } catch (e) {
      fail(e, "Could not remove player");
    }
  }
  async function promote(id: string) {
    close();
    try {
      await api.party.setLeader(id);
      setGlobalParty((p) => p && { ...p, leaderSteamId: id });
    } catch (e) {
      fail(e, "Could not change the leader");
    }
  }
  async function leave() {
    close();
    try {
      await api.party.leave();
      setGlobalParty(null);
    } catch (e) {
      fail(e, "Could not leave the party");
    }
  }

  return (
    <div ref={wrap} className={styles.party} role="group" aria-label="Party">
      {members.length < MAX_PARTY && !locked && (
        <span className={styles.slotWrap}>
          <button
            type="button"
            className={cx(styles.slot, styles.slotEmpty)}
            aria-label="Invite to party"
            aria-expanded={open === "invite"}
            onClick={() => setOpen((o) => (o === "invite" ? null : "invite"))}
          >
            <span aria-hidden="true">+</span>
          </button>
          {open === "invite" && (
            <span className={styles.inviteAnchor}>
              <InvitePopover inviteUrl={inviteUrl} ensureInvite={ensureInvite} onParty={setGlobalParty} onClose={close} />
            </span>
          )}
        </span>
      )}
      {ordered.map((m) => {
        const isMe = m.steamId === user.steamId;
        const isLeader = members.length > 1 && m.steamId === leaderId;
        const presence = m.presence ?? "online";
        return (
          <span key={m.steamId} className={styles.slotWrap}>
            <button
              type="button"
              className={cx(styles.slot, isMe && styles.slotMe)}
              aria-label={`${isMe ? "You" : m.displayName}${isLeader ? ", party leader" : ""}`}
              aria-haspopup="menu"
              aria-expanded={open === m.steamId}
              onClick={() => setOpen((o) => (o === m.steamId ? null : m.steamId))}
            >
              <Avatar name={m.displayName} src={m.avatarUrl} size="lg" status={presence === "offline" ? undefined : "online"} />
              {isLeader && <span className={styles.crown} aria-hidden="true" />}
            </button>
            {open === m.steamId && (
              <div className={styles.memberMenu} role="menu" aria-label={m.displayName}>
                <div className={styles.menuHead}>
                  <strong>{m.displayName}</strong>
                  <span className={styles.menuSub}>
                    {isLeader ? "Party leader" : members.length > 1 ? "Member" : "Solo"}
                    {!isMe && ` · ${PRESENCE_LABEL[presence]}`}
                  </span>
                </div>
                <Link href={`/profile/${m.steamId}`} role="menuitem" className={styles.menuItem} onClick={close}>
                  View profile
                </Link>
                {!isMe && iLead && (
                  <>
                    <button type="button" role="menuitem" className={styles.menuItem} disabled={locked} onClick={() => promote(m.steamId)}>
                      Make leader
                    </button>
                    <button type="button" role="menuitem" className={cx(styles.menuItem, styles.menuDanger)} disabled={locked} onClick={() => kick(m.steamId)}>
                      Kick from party
                    </button>
                  </>
                )}
                {isMe && members.length > 1 && (
                  <button type="button" role="menuitem" className={cx(styles.menuItem, styles.menuDanger)} disabled={locked} onClick={leave}>
                    Leave party
                  </button>
                )}
                {locked && members.length > 1 && <p className={styles.menuNote}>Party is locked while queued or in a match.</p>}
                {!locked && !isMe && !iLead && <p className={styles.menuNote}>Only the leader can promote or kick.</p>}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}
