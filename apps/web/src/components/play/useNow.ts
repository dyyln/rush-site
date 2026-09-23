"use client";

import { useEffect, useState } from "react";

// Wall clock that ticks while active. Null before the first tick so server and client render alike
export function useNow(active: boolean, everyMs = 250): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return active ? now : null;
}
