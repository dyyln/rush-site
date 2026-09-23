"use client";

import type { Mode } from "@rushsite/shared";
import { modeLabel } from "@/lib/modes";
import { getNotifySettings, notificationPermission } from "./settings";

export type Cue = "match_found" | "server_ready";

const SOUND: Record<Cue, string> = {
  match_found: "/sounds/match-found.wav",
  server_ready: "/sounds/server-ready.wav",
};

const audio = new Map<Cue, HTMLAudioElement>();

export function playCue(cue: Cue) {
  if (typeof window === "undefined") return;
  try {
    let el = audio.get(cue);
    if (!el) {
      el = new Audio(SOUND[cue]);
      el.volume = 0.7;
      audio.set(cue, el);
    }
    el.currentTime = 0;
    // Browsers block audio before the first user gesture. Nothing to do then
    void el.play().catch(() => {});
  } catch {
    // Audio not available
  }
}

function tabInBackground(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

const COPY: Record<Cue, { title: string; body: (mode: string, sec?: number) => string }> = {
  match_found: {
    title: "Match found",
    body: (m, sec) => (sec ? `${m} match found. Accept within ${sec} seconds.` : `${m} match found. Accept now.`),
  },
  server_ready: { title: "Server ready", body: (m) => `${m} server is ready. Connect now.` },
};

export function sendBrowserNotification(cue: Cue, mode: Mode | null, matchId: string, acceptSec?: number) {
  if (notificationPermission() !== "granted" || !tabInBackground()) return;
  const label = mode ? modeLabel(mode) : "Your";
  try {
    const n = new Notification(COPY[cue].title, {
      body: COPY[cue].body(label, acceptSec),
      tag: `${cue}:${matchId}`,
      icon: "/icon-512.png",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker
  }
}

export function fireCue(cue: Cue, mode: Mode | null, matchId: string, acceptSec?: number) {
  const s = getNotifySettings();
  if (s.sound) playCue(cue);
  if (s.browser) sendBrowserNotification(cue, mode, matchId, acceptSec);
}
