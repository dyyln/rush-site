"use client";

import { useSyncExternalStore } from "react";
import type { QueueStatusPayload } from "@rushsite/shared";
import { api } from "@/lib/api";
import { getRealtime, type Realtime } from "@/lib/ws";

// Match flow as seen from any page. Found holds the accept deadline
// slug is the match room id when the message carried one
export type GlobalMatch =
  | { phase: "found"; matchId: string; slug?: string; deadline: number }
  | { phase: "veto" | "ready"; matchId: string; slug?: string }
  | null;

export type GlobalPlay = { queue: QueueStatusPayload | null; match: GlobalMatch };

let state: GlobalPlay = { queue: null, match: null };
const listeners = new Set<() => void>();
let bound: Realtime | null = null;
let offs: (() => void)[] = [];

function set(patch: Partial<GlobalPlay>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const ENDED = new Set(["finished", "abandoned", "cancelled"]);

// Binds to the current realtime client. Rebinds after a sign out drops the old one
export function startPlayStore() {
  const rt = getRealtime();
  if (bound === rt) return;
  offs.forEach((off) => off());
  bound = rt;
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
  ];
  api.queueStatus().then(
    (queue) => {
      if (bound === rt && !state.queue) set({ queue });
    },
    () => {},
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: GlobalPlay = { queue: null, match: null };

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
