"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MatchFoundPayload,
  MatchResultPayload,
  ModeStatsPayload,
  Mode,
  PartyUpdatePayload,
  QueueStatusPayload,
  ServerReadyPayload,
  VetoStatePayload,
} from "@rushsite/shared";
import { api } from "./api";
import { getRealtime, type ConnectionState } from "./ws";

export type MatchPhase =
  | { phase: "none" }
  | { phase: "found"; found: MatchFoundPayload; responded: boolean }
  | { phase: "veto"; veto: VetoStatePayload }
  | { phase: "ready"; server: ServerReadyPayload; veto: VetoStatePayload | null }
  | { phase: "result"; result: MatchResultPayload };

const IDLE: QueueStatusPayload = { state: "idle", partyId: null, modes: [], cooldownUntil: null };

// Live state for the play page. REST gives the first snapshot, WS keeps it current
export function usePlay() {
  const rt = getRealtime();
  const [connection, setConnection] = useState<ConnectionState>(rt.state);
  const [queue, setQueue] = useState<QueueStatusPayload>(IDLE);
  const [party, setParty] = useState<PartyUpdatePayload | null>(null);
  const [match, setMatch] = useState<MatchPhase>({ phase: "none" });
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<ModeStatsPayload | null>(null);

  useEffect(() => {
    rt.connect();
    const offs = [
      rt.onState(setConnection),
      rt.on("queue_status", setQueue),
      rt.on("party_update", setParty),
      rt.on("mode_stats", setStats),
      rt.on("match_found", (found) =>
        setMatch((m) => ({ phase: "found", found, responded: m.phase === "found" && m.found.matchId === found.matchId && m.responded })),
      ),
      rt.on("veto_state", (veto) => setMatch({ phase: "veto", veto })),
      rt.on("server_ready", (server) =>
        setMatch((m) => ({ phase: "ready", server, veto: m.phase === "veto" ? m.veto : null })),
      ),
      rt.on("match_result", (result) => setMatch({ phase: "result", result })),
    ];
    setConnection(rt.state);
    let live = true;
    api.modeStats().then(
      (s) => live && setStats((cur) => cur ?? s),
      () => {},
    );
    Promise.allSettled([api.queueStatus(), api.party.get()]).then(([q, p]) => {
      if (!live) return;
      if (q.status === "fulfilled") setQueue(q.value);
      if (p.status === "fulfilled") setParty(p.value);
      setLoaded(true);
    });
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [rt]);

  const joinQueue = useCallback((modes: Mode[]) => rt.send("queue_join", { modes }), [rt]);
  const leaveQueue = useCallback((modes?: Mode[]) => rt.send("queue_leave", modes ? { modes } : {}), [rt]);

  const respond = useCallback(
    (accept: boolean) => {
      if (match.phase !== "found") return;
      rt.send("accept_match", { matchId: match.found.matchId, accept });
      setMatch(accept ? { ...match, responded: true } : { phase: "none" });
    },
    [rt, match],
  );

  const vote = useCallback(
    (mapId: string) => {
      if (match.phase === "veto") rt.send("veto_vote", { matchId: match.veto.matchId, mapId });
    },
    [rt, match],
  );

  const dismissMatch = useCallback(() => setMatch({ phase: "none" }), []);

  return { connection, queue, stats, party, setParty, match, loaded, joinQueue, leaveQueue, respond, vote, dismissMatch };
}
