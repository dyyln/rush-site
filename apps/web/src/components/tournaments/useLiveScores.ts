"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bracket, MatchUpdate } from "@/lib/types";
import { getRealtime } from "@/lib/ws";
import { applyMatchUpdates, liveMatchIds } from "./bracketScore";

// The socket allows 20 match subscriptions. A few stay free for other pages
const MAX_FOLLOWED = 16;

// Round scores move without a bracket version bump, so live games are followed over match_update
export function useLiveScores(bracket: Bracket | null, signedIn: boolean): Bracket | null {
  const [updates, setUpdates] = useState<ReadonlyMap<string, MatchUpdate>>(() => new Map());
  const ids = liveMatchIds(bracket).slice(0, MAX_FOLLOWED);
  const key = ids.join(",");

  useEffect(() => {
    if (!signedIn || !key) return;
    const followed = key.split(",");
    const rt = getRealtime();
    rt.connect();
    const subscribe = () => followed.forEach((matchId) => rt.send("subscribe_match", { matchId }));
    subscribe();
    const offs = [
      rt.onState((s) => {
        if (s === "open") subscribe();
      }),
      rt.on("match_update", (p) => {
        if (!followed.includes(p.matchId) || p.teams.length < 2) return;
        setUpdates((prev) => new Map(prev).set(p.matchId, p));
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      followed.forEach((matchId) => rt.send("unsubscribe_match", { matchId }));
    };
  }, [key, signedIn]);

  // Updates only apply to a bracket match whose live game they name, so finished games drop out
  return useMemo(() => (bracket ? applyMatchUpdates(bracket, updates) : null), [bracket, updates]);
}
