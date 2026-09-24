"use client";

import { useSyncExternalStore } from "react";
import type { MatchStatus, PartyUpdatePayload, QueueStatusPayload } from "@rushsite/shared";
import { api } from "@/lib/api";
import { isMock } from "@/lib/env";
import type { MatchDetail } from "@/lib/types";
import { getRealtime, type Realtime } from "@/lib/ws";

// Match flow as seen from any page. Found holds the accept deadline
// slug is the match room id when the message carried one. live is a match already under way when the page loaded
export type GlobalMatch =
  | { phase: "found"; matchId: string; slug?: string; deadline: number }
  | { phase: "veto" | "ready" | "live"; matchId: string; slug?: string }
  | null;

export type GlobalPlay = { queue: QueueStatusPayload | null; match: GlobalMatch; party: PartyUpdatePayload | null };

let state: GlobalPlay = { queue: null, match: null, party: null };
const listeners = new Set<() => void>();
let bound: Realtime | null = null;
let offs: (() => void)[] = [];

function set(patch: Partial<GlobalPlay>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const ENDED = new Set<MatchStatus>(["finished", "abandoned", "cancelled"]);

// Binds to the current realtime client. Rebinds after a sign out drops the old one
export function startPlayStore() {
  const rt = getRealtime();
  if (bound === rt) return;
  offs.forEach((off) => off());
  bound = rt;
  state = { queue: null, match: null, party: null };
  rt.connect();
  offs = [
    rt.on("queue_status", (queue) => {
      // A new queue or a cooldown means the last match flow is over
      set(queue.state === "idle" ? { queue } : { queue, match: null });
    }),
    rt.on("match_found", (p) => set({ match: { phase: "found", matchId: p.matchId, slug: p.slug, deadline: p.acceptDeadline } })),
    rt.on("veto_state", (p) => set({ match: { phase: "veto", matchId: p.matchId, slug: p.slug } })),
    rt.on("server_ready", (p) => set({ match: { phase: "ready", matchId: p.matchId, slug: p.slug } })),
    rt.on("match_result", () => set({ match: null })),
    rt.on("match_cancelled", () => set({ match: null })),
    rt.on("match_update", (p) => {
      if (state.match?.matchId === p.matchId && ENDED.has(p.status)) set({ match: null });
    }),
    rt.on("party_update", (party) => set({ party })),
    // Presence of party mates arrives as friend updates
    rt.on("friend_update", (u) => {
      const p = state.party;
      if (u.kind !== "presence" || !u.presence || !p?.members.some((m) => m.steamId === u.steamId)) return;
      const presence = u.presence;
      set({ party: { ...p, members: p.members.map((m) => (m.steamId === u.steamId ? { ...m, presence } : m)) } });
    }),
  ];
  api.queueStatus().then(
    (queue) => {
      if (bound === rt && !state.queue) set({ queue });
    },
    () => {},
  );
  api.party.get().then(
    (party) => {
      if (bound === rt && !state.party) set({ party });
    },
    () => {},
  );
  // No message covers a match that was already running when the page loaded, so ask once
  if (!isMock) {
    api.get<{ match: MatchDetail | null }>("/matches/current").then(
      ({ match: cur }) => {
        if (bound !== rt || !cur || ENDED.has(cur.status) || state.match) return;
        set({ match: { phase: "live", matchId: cur.id, slug: cur.slug } });
      },
      () => {},
    );
  }
}

// Local change after a party call, before the server's party_update lands
export function setGlobalParty(next: PartyUpdatePayload | null | ((p: PartyUpdatePayload | null) => PartyUpdatePayload | null)) {
  set({ party: typeof next === "function" ? next(state.party) : next });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: GlobalPlay = { queue: null, match: null, party: null };

export function useGlobalPlay(): GlobalPlay {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

// Earliest queuedAt across queued modes, or null when not queued
export function queuedSince(q: QueueStatusPayload | null): number | null {
  if (!q || q.state !== "queued" || q.modes.length === 0) return null;
  return Math.min(...q.modes.map((m) => m.queuedAt));
}
