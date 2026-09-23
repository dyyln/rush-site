"use client";

import { useCallback, useSyncExternalStore } from "react";

export type NotifySettings = {
  sound: boolean;
  browser: boolean;
};

const KEY = "rushsite.notify.v1";
const EVENT = "rushsite:notify-settings";
const DEFAULTS: NotifySettings = { sound: true, browser: false };

let cache: NotifySettings | null = null;

function read(): NotifySettings {
  if (cache) return cache;
  let next = DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<NotifySettings>;
      next = {
        sound: typeof v.sound === "boolean" ? v.sound : DEFAULTS.sound,
        browser: typeof v.browser === "boolean" ? v.browser : DEFAULTS.browser,
      };
    }
  } catch {
    // Storage blocked or bad JSON. Use defaults
  }
  cache = next;
  return next;
}

export function getNotifySettings(): NotifySettings {
  if (typeof window === "undefined") return DEFAULTS;
  return read();
}

export function setNotifySettings(patch: Partial<NotifySettings>) {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Keeps the in-memory value for this tab
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useNotifySettings(): [NotifySettings, (patch: Partial<NotifySettings>) => void] {
  const value = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((patch: Partial<NotifySettings>) => setNotifySettings(patch), []);
  return [value, update];
}

export type PermissionState = NotificationPermission | "unsupported";

export function notificationPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
