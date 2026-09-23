"use client";

import { useEffect } from "react";
import { getNotifySettings } from "@/components/notify/settings";

const TICK_URL = "/sounds/veto-tick.wav";
let tick: HTMLAudioElement | null = null;

function playTick() {
  try {
    tick ??= new Audio(TICK_URL);
    tick.volume = 0.5;
    tick.currentTime = 0;
    // Blocked before the first user gesture. Nothing to do then
    void tick.play().catch(() => {});
  } catch {
    // Audio not available
  }
}

// Short tick at 5, 4, 3, 2 and 1 seconds left. Follows the match found sound setting
export function useVetoTicks(deadline: number | null, active: boolean) {
  useEffect(() => {
    if (!active || deadline === null) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 5; s >= 1; s--) {
      const wait = deadline - s * 1000 - Date.now();
      if (wait < -200) continue;
      timers.push(
        setTimeout(() => {
          if (getNotifySettings().sound) playTick();
        }, Math.max(0, wait)),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [deadline, active]);
}
