"use client";

import { mmss } from "@/lib/format";
import { useNow } from "./useNow";

// "Start in 0:42" for the queue button during a cooldown
export function StartCountdown({ until }: { until: number }) {
  const now = useNow(true, 500);
  const sec = now === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <>
      Start in <span className="mono">{sec === null ? "--:--" : mmss(sec)}</span>
    </>
  );
}
