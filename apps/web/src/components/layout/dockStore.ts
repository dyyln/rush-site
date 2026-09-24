"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

// A page's own content for the dock: the state line in the middle and the big action on the right.
// The dock shows it instead of the queue controls while the page is open. A live match elsewhere still wins
export type DockAction = {
  label: string;
  value: ReactNode;
  // Right hand slot. Build it from DockLink, DockButton and DockTimer so it matches the dock. null leaves it empty
  action: ReactNode;
};

type Entry = { id: number; action: DockAction };

let entries: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The most recently mounted page action
function top(): DockAction | null {
  return entries.at(-1)?.action ?? null;
}

export function usePageDockAction(): DockAction | null {
  return useSyncExternalStore(subscribe, top, () => null);
}

// Puts content in the dock while the calling component is mounted. null takes it out again
export function useDockAction(action: DockAction | null) {
  const id = useRef(0);
  if (id.current === 0) id.current = nextId++;

  // Every render hands over the newest content. Countdowns tick inside their own components, so this runs on real changes
  useEffect(() => {
    const i = entries.findIndex((e) => e.id === id.current);
    if (!action) {
      if (i < 0) return;
      entries = entries.filter((e) => e.id !== id.current);
    } else if (i < 0) {
      entries = [...entries, { id: id.current, action }];
    } else {
      entries = entries.map((e) => (e.id === id.current ? { id: e.id, action } : e));
    }
    emit();
  });

  useEffect(
    () => () => {
      entries = entries.filter((e) => e.id !== id.current);
      emit();
    },
    [],
  );
}
