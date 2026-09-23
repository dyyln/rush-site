"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MatchDetail } from "@/lib/types";

// match_update carries no kills, MVP or demo. Refetch the detail when a round lands or the status changes
export function useLiveExtras(m: MatchDetail | null): MatchDetail | null {
  const [fresh, setFresh] = useState<MatchDetail | null>(null);
  const key = m ? `${m.id}:${m.status}:${m.rounds.length}` : null;
  const initial = useRef<string | null>(null);

  useEffect(() => {
    if (!key || !m) return;
    // The first load already has the extras
    if (initial.current === null || !initial.current.startsWith(`${m.id}:`)) {
      initial.current = key;
      setFresh(null);
      return;
    }
    if (initial.current === key) return;
    let live = true;
    const t = setTimeout(() => {
      api.match(m.id).then(
        (x) => live && setFresh(x),
        () => {},
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);

  if (!m) return null;
  if (!fresh || fresh.id !== m.id || fresh.rounds.length < m.rounds.length) return m;
  // Scores and status come from the socket. Stats and extras from the refetch
  return {
    ...m,
    teams: m.teams.map((t) => ({ ...t, players: fresh.teams.find((f) => f.name === t.name)?.players ?? t.players })),
    kills: fresh.kills,
    mvp: fresh.mvp,
    demo: fresh.demo,
    ratingDeltas: fresh.ratingDeltas,
    viewerReported: fresh.viewerReported,
  };
}
