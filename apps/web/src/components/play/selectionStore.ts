"use client";

import { useSyncExternalStore } from "react";
import { MODE_CONFIGS, type Mode, type PartyUpdatePayload, type ServiceStatus } from "@rushsite/shared";
import { MODE_COPY } from "@/lib/modes";
import { modeUnavailable, offeredModes } from "@/components/stats/useServiceStatus";
import { loadLastModes, saveLastModes } from "./lastModes";

// Modes picked on Play. The dock on every page queues for these. Kept in storage so they survive a reload

let selected: Mode[] | null = null;
const listeners = new Set<() => void>();

function current(): Mode[] {
  if (selected === null) selected = typeof window === "undefined" ? [] : loadLastModes();
  return selected;
}

export function setSelectedModes(next: Mode[] | ((s: Mode[]) => Mode[])) {
  const value = typeof next === "function" ? next(current()) : next;
  if (value.length === current().length && value.every((m, i) => m === current()[i])) return;
  selected = value;
  saveLastModes(value);
  listeners.forEach((l) => l());
}

export function toggleSelectedMode(mode: Mode) {
  setSelectedModes((s) => (s.includes(mode) ? s.filter((m) => m !== mode) : [...s, mode]));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const NONE: Mode[] = [];

export function useSelectedModes(): Mode[] {
  return useSyncExternalStore(subscribe, current, () => NONE);
}

export function partySizeOf(party: PartyUpdatePayload | null): number {
  return Math.max(1, party?.members.length ?? 1);
}

// Why a mode cannot be queued right now, or null when it can
export function modeBlockReason(mode: Mode, partySize: number, service: ServiceStatus | null): string | null {
  if (!offeredModes(service).includes(mode)) return "Not offered right now";
  const size = MODE_CONFIGS[mode].teamSize;
  if (partySize > size) return `Party of ${partySize} · max ${size}`;
  return modeUnavailable(service, mode);
}

// Selected modes that can queue now
export function eligibleModes(selectedModes: readonly Mode[], partySize: number, service: ServiceStatus | null): Mode[] {
  return selectedModes.filter((m) => !modeBlockReason(m, partySize, service));
}

export function modesLabel(modes: readonly Mode[]): string {
  return modes.map((m) => MODE_COPY[m].label).join(" + ");
}
