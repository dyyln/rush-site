"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Wraps an async action so it cannot run twice at once. Use pending to disable the submit button
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const latest = useRef(fn);
  const mounted = useRef(true);
  latest.current = fn;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await latest.current(...args);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  return { run, pending };
}
