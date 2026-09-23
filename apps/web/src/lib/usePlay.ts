"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ErrorPayload,
  MatchCancelledPayload,
  MatchFoundPayload,
  MatchResultPayload,
  ModeStatsPayload,
  Mode,
  PartyUpdatePayload,
  QueueStatusPayload,
  TrustLevel,
  ServerReadyPayload,
  VetoStatePayload,
} from "@rushsite/shared";
import { api } from "./api";
import { isMock } from "./env";
import type { MatchDetail } from "./types";
import { getRealtime, type ConnectionState } from "./ws";

export type MatchCancelled = MatchCancelledPayload;
export type WsError = ErrorPayload;

type Notices = { onCancelled?: (c: MatchCancelled) => void; onError?: (e: WsError) => void };

export type MatchPhase =
  | { phase: "none" }
  | { phase: "found"; found: MatchFoundPayload; responded: boolean }
  | { phase: "veto"; veto: VetoStatePayload }
  | { phase: "ready"; server: ServerReadyPayload; veto: VetoStatePayload | null }
  // Server is being allocated. Seen on load, for example right after a challenge is accepted
  | { phase: "starting"; matchId: string; mode: Mode; status?: "allocating" | "starting" }
  // mapId and veto come from the phase before the result, when known
  | { phase: "result"; result: MatchResultPayload; mapId?: string; veto?: VetoStatePayload | null };

// Warm-up progress on the connect card
export type Warmup = { matchId: string; connected: number; expected: number };

const IDLE: QueueStatusPayload = { state: "idle", partyId: null, modes: [], cooldownUntil: null };

// Live state for the play page. REST gives the first snapshot, WS keeps it current
export function usePlay(notices: Notices = {}) {
  const rt = getRealtime();
  const [connection, setConnection] = useState<ConnectionState>(rt.state);
  const [queue, setQueue] = useState<QueueStatusPayload>(IDLE);
  const [party, setParty] = useState<PartyUpdatePayload | null>(null);
  const [match, setMatch] = useState<MatchPhase>({ phase: "none" });
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<ModeStatsPayload | null>(null);
  const [warmup, setWarmup] = useState<Warmup | null>(null);
  const noticesRef = useRef(notices);
  noticesRef.current = notices;

  useEffect(() => {
    rt.connect();
    const offs = [
      rt.onState((s) => {
        setConnection(s);
        // The server only broadcasts stats on change, so take a fresh snapshot after every reconnect
        if (s === "open") loadStats();
      }),
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
      rt.on("match_result", (result) =>
        setMatch((m) => {
          const ready = m.phase === "ready" && m.server.matchId === result.matchId ? m : null;
          const veto = ready?.veto ?? (m.phase === "veto" && m.veto.matchId === result.matchId ? m.veto : null);
          return { phase: "result", result, mapId: ready?.server.mapId ?? (veto?.state.done ? veto.state.maps[0] : undefined), veto };
        }),
      ),
      rt.on("match_cancelled", (p) => {
        setMatch({ phase: "none" });
        noticesRef.current.onCancelled?.(p);
      }),
      rt.on("error", (p) => noticesRef.current.onError?.(p)),
      rt.on("match_update", (p) => {
        if (p.connected !== undefined && p.expected !== undefined) setWarmup({ matchId: p.matchId, connected: p.connected, expected: p.expected });
      }),
    ];
    setConnection(rt.state);
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Retries until it succeeds. A failed first load used to leave the cards blank for good
    function loadStats() {
      clearTimeout(retry);
      api.modeStats().then(
        (s) => live && setStats(s),
        () => {
          if (live) retry = setTimeout(loadStats, 5000);
        },
      );
    }
    loadStats();
    // No WS message covers allocation, so ask once on load. Live messages win over this answer
    if (!isMock) {
      api.get<{ match: MatchDetail | null }>("/matches/current").then(
        ({ match: cur }) => {
          if (!live || !cur || (cur.status !== "allocating" && cur.status !== "starting")) return;
          setMatch((m) => (m.phase === "none" ? { phase: "starting", matchId: cur.id, mode: cur.mode, status: cur.status as "allocating" | "starting" } : m));
        },
        () => {},
      );
    }
    Promise.allSettled([api.queueStatus(), api.party.get()]).then(([q, p]) => {
      if (!live) return;
      if (q.status === "fulfilled") setQueue(q.value);
      if (p.status === "fulfilled") setParty(p.value);
      setLoaded(true);
    });
    return () => {
      live = false;
      clearTimeout(retry);
      offs.forEach((off) => off());
    };
  }, [rt]);

  const joinQueue = useCallback(
    (modes: Mode[], minTrust?: TrustLevel) => rt.send("queue_join", minTrust ? { modes, minTrust } : { modes }),
    [rt],
  );
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

  return { connection, queue, stats, party, setParty, match, loaded, joinQueue, leaveQueue, respond, vote, dismissMatch, warmup };
}
