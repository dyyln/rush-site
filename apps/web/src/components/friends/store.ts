"use client";

// One shared copy of the friends list and the pending counts. Every hook reads from here so the
// header badge, the /play card and the /friends page stay in step with a single socket listener
import { useEffect, useSyncExternalStore } from "react";
import type { FriendsPendingResponse, FriendsResponse, FriendUpdatePayload, PartyInvite } from "@rushsite/shared";
import { api } from "@/lib/api";
import { getRealtime } from "@/lib/ws";

type Slot<T> = { data: T | null; error: Error | null; loading: boolean };

let friends: Slot<FriendsResponse> = { data: null, error: null, loading: false };
let pending: Slot<FriendsPendingResponse> = { data: null, error: null, loading: false };
const listeners = new Set<() => void>();
let users = 0;
let offs: (() => void)[] = [];
let wanted = { friends: false };

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function reloadFriends(): Promise<void> {
  wanted.friends = true;
  friends = { ...friends, loading: true };
  emit();
  try {
    friends = { data: await api.friends.list(), error: null, loading: false };
  } catch (e) {
    friends = { ...friends, error: e instanceof Error ? e : new Error(String(e)), loading: false };
  }
  emit();
}

export async function reloadPending(): Promise<void> {
  pending = { ...pending, loading: true };
  try {
    pending = { data: await api.friends.pending(), error: null, loading: false };
  } catch (e) {
    pending = { ...pending, error: e instanceof Error ? e : new Error(String(e)), loading: false };
  }
  emit();
}

function onFriendUpdate(p: FriendUpdatePayload) {
  if (p.kind === "presence") {
    if (!friends.data || !p.presence) return;
    friends = {
      ...friends,
      data: {
        ...friends.data,
        friends: friends.data.friends.map((f) => {
          if (f.steamId !== p.steamId) return f;
          const { detail: _old, ...rest } = f;
          return { ...rest, presence: p.presence!, ...(p.detail ? { detail: p.detail } : {}) };
        }),
      },
    };
    emit();
    return;
  }
  if (wanted.friends) void reloadFriends();
  void reloadPending();
}

function onInvite(invite: PartyInvite) {
  const cur = pending.data ?? { requests: 0, invites: [] };
  const rest = cur.invites.filter((i) => i.id !== invite.id);
  const open = (invite.status ?? "pending") === "pending" && Date.parse(invite.expiresAt) > Date.now();
  pending = { ...pending, data: { ...cur, invites: open ? [invite, ...rest] : rest } };
  emit();
}

function attach() {
  const rt = getRealtime();
  rt.connect();
  offs = [
    rt.on("friend_update", onFriendUpdate),
    rt.on("party_invite", (p) => onInvite(p.invite)),
    // A reconnect may have missed pushes
    rt.onState((s) => {
      if (s !== "open") return;
      void reloadPending();
      if (wanted.friends) void reloadFriends();
    }),
  ];
}

function detach() {
  offs.forEach((o) => o());
  offs = [];
  friends = { data: null, error: null, loading: false };
  pending = { data: null, error: null, loading: false };
  wanted = { friends: false };
}

// Keeps the socket listeners alive while any friends hook is mounted
function useLifecycle(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (users++ === 0) attach();
    return () => {
      if (--users === 0) detach();
    };
  }, [enabled]);
}

export function useFriends(enabled = true) {
  useLifecycle(enabled);
  const snap = useSyncExternalStore(subscribe, () => friends, () => friends);
  useEffect(() => {
    if (enabled && !friends.data && !friends.loading) void reloadFriends();
  }, [enabled]);
  return { ...snap, reload: reloadFriends };
}

export function usePending(enabled = true) {
  useLifecycle(enabled);
  const snap = useSyncExternalStore(subscribe, () => pending, () => pending);
  useEffect(() => {
    if (enabled && !pending.data && !pending.loading) void reloadPending();
  }, [enabled]);
  const count = (snap.data?.requests ?? 0) + (snap.data?.invites.length ?? 0);
  return { ...snap, count, reload: reloadPending };
}

// Drops an invite locally once it is answered
export function forgetInvite(id: string) {
  if (!pending.data) return;
  pending = { ...pending, data: { ...pending.data, invites: pending.data.invites.filter((i) => i.id !== id) } };
  emit();
}
