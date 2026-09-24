"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isTestMode, MODES, type Mode, type ServiceStatus } from "@rushsite/shared";
import { getRealtime, type Realtime } from "@/lib/ws";
import { unavailableText } from "./copy";
import { statsApi, visibleStatus } from "./statsApi";

// Fallback poll for viewers without a socket. Signed in viewers get service_status pushes
const REFRESH_MS = 60_000;
// Focus and visibility often fire together
const MIN_GAP_MS = 2_000;

// One status shared by every component on the page
let current: ServiceStatus | null = null;
const listeners = new Set<() => void>();
let users = 0;
let bound: Realtime | null = null;
let offs: (() => void)[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastLoad = 0;
let loading = false;

// A reply computed before the newest push must not undo it
function accept(s: ServiceStatus) {
  if (current && Date.parse(s.updatedAt) < Date.parse(current.updatedAt)) return;
  current = s;
  listeners.forEach((l) => l());
}

function load(force = false) {
  bind();
  const t = Date.now();
  if (loading || (!force && t - lastLoad < MIN_GAP_MS)) return;
  loading = true;
  lastLoad = t;
  // Keeps the last good answer on errors
  statsApi
    .status()
    .then(accept, () => undefined)
    .finally(() => {
      loading = false;
    });
}

// Follows the current realtime client. A sign out replaces it
function bind() {
  const rt = getRealtime();
  if (bound === rt) return;
  offs.forEach((off) => off());
  bound = rt;
  offs = [
    rt.on("service_status", (s) => accept(visibleStatus(s))),
    // Pushes sent while the socket was down are lost, so read again on every connect
    rt.onState((s) => {
      if (s === "open") load(true);
    }),
  ];
}

function onVisible() {
  if (document.visibilityState === "visible") load();
}

function start() {
  load(true);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") load();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  offs.forEach((off) => off());
  offs = [];
  bound = null;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Live GET /status. Null until the first answer
export function useServiceStatus(): ServiceStatus | null {
  useEffect(() => {
    if (users++ === 0) start();
    return () => {
      if (--users === 0) stop();
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

// Modes the site offers. A test mode shows only once the status lists it, which means the server turned it on
export function offeredModes(status: ServiceStatus | null): Mode[] {
  return MODES.filter((m) => !isTestMode(m) || !!status?.modes.some((x) => x.mode === m));
}

// Short reason text when the mode cannot queue, null when it can
export function modeUnavailable(status: ServiceStatus | null, mode: Mode): string | null {
  const m = status?.modes.find((x) => x.mode === mode);
  return m && !m.available ? unavailableText(m.reason) : null;
}
