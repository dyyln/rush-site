"use client";

import { useEffect, useRef } from "react";

// Runs fn every ms while the tab is visible. Runs once more when the tab comes back
export function useVisibleInterval(fn: () => void, ms: number, enabled: boolean) {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer && document.visibilityState === "visible") timer = setInterval(() => ref.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      ref.current();
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}
