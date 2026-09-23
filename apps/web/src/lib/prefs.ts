"use client";

import { useCallback, useSyncExternalStore } from "react";
import { PREFS_KEY } from "./prefs-boot";

// Display preferences kept in this browser. Each one also sets a data attribute on html
// so CSS can apply it before React hydrates
export type Prefs = {
  tiersOnly: boolean;
  cbPalette: boolean;
};

const EVENT = "rushsite:prefs";
const DEFAULTS: Prefs = { tiersOnly: false, cbPalette: false };

let cache: Prefs | null = null;

function read(): Prefs {
  if (cache) return cache;
  let next = DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Prefs>;
      next = {
        tiersOnly: v.tiersOnly === true,
        cbPalette: v.cbPalette === true,
      };
    }
  } catch {
    // Storage blocked or bad JSON. Use defaults
  }
  cache = next;
  return next;
}

function applyToDocument(p: Prefs) {
  const html = document.documentElement;
  if (p.tiersOnly) html.dataset.tiersOnly = "true";
  else delete html.dataset.tiersOnly;
  if (p.cbPalette) html.dataset.palette = "cb";
  else delete html.dataset.palette;
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(cache));
  } catch {
    // Keeps the in-memory value for this tab
  }
  applyToDocument(cache);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PREFS_KEY) return;
    cache = null;
    applyToDocument(read());
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const value = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((patch: Partial<Prefs>) => setPrefs(patch), []);
  return [value, update];
}

// True when rating numbers should be hidden
export function useTiersOnly(): boolean {
  return usePrefs()[0].tiersOnly;
}

// Formats a rating for text. Returns null when the viewer hides rating numbers
export function formatRating(rating: number | null | undefined, tiersOnly: boolean): string | null {
  if (tiersOnly || rating === null || rating === undefined || Number.isNaN(rating)) return null;
  return String(Math.round(rating));
}
