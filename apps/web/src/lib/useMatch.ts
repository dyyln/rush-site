"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { MatchDetail, MatchUpdate } from "./types";
import { getRealtime } from "./ws";

function apply(m: MatchDetail, u: MatchUpdate): MatchDetail {
  const rounds =
    u.lastRound && !m.rounds.some((r) => r.round === u.lastRound!.round) ? [...m.rounds, u.lastRound] : m.rounds;
  return {
    ...m,
    status: u.status,
    teams: m.teams.map((t) => ({ ...t, score: u.teams.find((x) => x.name === t.name)?.score ?? t.score })),
    rounds,
  };
}

// Loads a match and follows it live while the page is open
export function useMatch(id: string) {
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let live = true;
    setMatch(null);
    setError(null);
    api.match(id).then(
      (m) => live && setMatch(m),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    const rt = getRealtime();
    rt.connect();
    const subscribe = () => rt.send("subscribe_match", { matchId: id });
    subscribe();
    const offs = [
      rt.onState((s) => s === "open" && subscribe()),
      rt.on("match_update", (p) => {
        if (p.matchId === id) setMatch((m) => (m ? apply(m, p) : m));
      }),
    ];
    return () => {
      live = false;
      offs.forEach((off) => off());
      rt.send("unsubscribe_match", { matchId: id });
    };
  }, [id]);

  return { match, error };
}
