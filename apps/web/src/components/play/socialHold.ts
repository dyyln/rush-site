"use client";

// Holds social toasts (party invites, challenges, friend requests) while the player is in the
// accept, veto or connect phase of a match. They show once the phase ends
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useToast, type ToastInput } from "@/components/ui/Toast";
import { getRealtime } from "@/lib/ws";

// A stuck phase never holds toasts for longer than this
const MAX_HOLD_MS = 5 * 60_000;
const ENDED = new Set(["live", "finished", "abandoned", "cancelled"]);

let busy = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let attached = 0;
let offs: (() => void)[] = [];
const listeners = new Set<() => void>();

function set(next: boolean) {
  clearTimeout(releaseTimer);
  if (next) releaseTimer = setTimeout(() => set(false), MAX_HOLD_MS);
  if (busy === next) return;
  busy = next;
  listeners.forEach((l) => l());
}

function attach() {
  const rt = getRealtime();
  offs = [
    rt.on("match_found", () => set(true)),
    rt.on("veto_state", () => set(true)),
    rt.on("server_ready", () => set(true)),
    rt.on("match_result", () => set(false)),
    rt.on("match_cancelled", () => set(false)),
    rt.on("match_update", (p) => {
      if (ENDED.has(p.status)) set(false);
    }),
  ];
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (attached++ === 0) attach();
  return () => {
    listeners.delete(l);
    if (--attached === 0) {
      offs.forEach((o) => o());
      offs = [];
    }
  };
}

// Lets the Play page clear the hold when the player declines or leaves the match locally
export function releaseSocialHold() {
  set(false);
}

export function useMatchBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busy, () => false);
}

type Held = { key: number; input: ToastInput; expiresAt?: number };

// Same shape as useToast. Pushes made during a match phase wait until it ends
export function useSocialToast() {
  const toast = useToast();
  const isBusy = useMatchBusy();
  const held = useRef<Held[]>([]);
  // Held keys are negative so they never clash with real toast ids
  const nextKey = useRef(-1);
  // Held key to the toast id and the entry, for toasts on screen
  const live = useRef(new Map<number, { id: number; held: Held; until: number }>());

  const show = useCallback(
    (h: Held) => {
      let input = h.input;
      if (h.expiresAt !== undefined) {
        const left = h.expiresAt - Date.now();
        if (left <= 0) return;
        input = { ...input, durationMs: Math.max(5000, Math.min(input.durationMs ?? 60_000, left)) };
      }
      const ms = input.durationMs ?? 5000;
      live.current.set(h.key, { id: toast.push(input), held: h, until: ms > 0 ? Date.now() + ms : Infinity });
    },
    [toast],
  );

  useEffect(() => {
    // A new match phase takes social toasts already on screen off it until the phase ends
    if (isBusy) {
      const now = Date.now();
      live.current.forEach(({ id, held: h, until }) => {
        if (until <= now) return;
        toast.dismiss(id);
        held.current.push(h);
      });
      live.current.clear();
      return;
    }
    if (held.current.length === 0) return;
    const list = held.current;
    held.current = [];
    list.forEach(show);
  }, [isBusy, show, toast]);

  const push = useCallback(
    (input: ToastInput & { expiresAt?: number }) => {
      const { expiresAt, ...rest } = input;
      const h: Held = { key: nextKey.current--, input: rest, expiresAt };
      if (busy) held.current.push(h);
      else show(h);
      return h.key;
    },
    [show],
  );

  const dismiss = useCallback(
    (key: number) => {
      held.current = held.current.filter((h) => h.key !== key);
      const entry = live.current.get(key);
      if (entry) toast.dismiss(entry.id);
      live.current.delete(key);
    },
    [toast],
  );

  return useMemo(() => ({ push, dismiss }), [push, dismiss]);
}
