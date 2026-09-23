"use client";

import { useEffect, useRef } from "react";
import { mmss } from "@/lib/format";
import { queuedSince, type GlobalPlay } from "./playStore";
import { useNow } from "./useNow";

// Shows the accept countdown or the queue timer in the tab title and restores it afterwards
export function useTabTitle({ queue, match }: GlobalPlay) {
  const since = queuedSince(queue);
  const deadline = match?.phase === "found" ? match.deadline : null;
  const now = useNow(since !== null || deadline !== null, 500);
  const base = useRef<string | null>(null);
  const last = useRef<string | null>(null);

  let text: string | null = null;
  if (now !== null) {
    if (deadline !== null && deadline > now) text = `${mmss(Math.ceil((deadline - now) / 1000))} · Accept match`;
    else if (since !== null) text = `${mmss((now - since) / 1000)} · In queue`;
  }

  useEffect(() => {
    if (text === null) {
      if (base.current !== null && document.title === last.current) document.title = base.current;
      base.current = null;
      last.current = null;
      return;
    }
    // A page navigation replaced the title. Take it as the new base
    if (base.current === null || document.title !== last.current) base.current = document.title;
    document.title = text;
    last.current = text;
  }, [text]);

  useEffect(
    () => () => {
      if (base.current !== null && document.title === last.current) document.title = base.current;
    },
    [],
  );
}
