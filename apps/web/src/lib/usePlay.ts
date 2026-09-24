"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ErrorPayload,
  MatchCancelledPayload,
  MatchFoundPayload,
  MatchResultPayload,
  MatchStatus,
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
  | { phase: "starting"; matchId: string; slug?: string; mode: Mode; status?: MatchStatus; veto?: VetoStatePayload }
  // mapId and veto come from the phase before the result, when known
  | { phase: "result"; result: MatchResultPayload; mapId?: string; veto?: VetoStatePayload | null };

// Warm-up progress on the connect card
export type Warmup = { matchId: string; connected: number; expected: number };

const ENDED = new Set<MatchStatus>(["finished", "abandoned", "cancelled"]);

// The match the player is in right now, with its room id when known
export function activeMatch(m: MatchPhase): { matchId: string; slug?: string } | null {
  switch (m.phase) {
    case "found":
      return { matchId: m.found.matchId, slug: m.found.slug };
    case "veto":
      return { matchId: m.veto.matchId, slug: m.veto.slug };
    case "ready":
      return { matchId: m.server.matchId, slug: m.server.slug };
    case "starting":
      return { matchId: m.matchId, slug: m.slug };
    default:
      return null;
  }
}

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
      // The last veto state carries done, and no other message covers allocation, so move on here
      rt.on("veto_state", (veto) =>
        setMatch(
          veto.state.done
            ? { phase: "starting", matchId: veto.matchId, slug: veto.slug, mode: veto.mode, status: "allocating", veto }
            : { phase: "veto", veto },
        ),
      ),
      rt.on("server_ready", (server) =>
        setMatch((m) => ({ phase: "ready", server, veto: m.phase === "veto" ? m.veto : m.phase === "starting" ? (m.veto ?? null) : null })),
      ),
      rt.on("match_result", (result) =>
        setMatch((m) => {
          const ready = m.phase === "ready" && m.server.matchId === result.matchId ? m : null;
          const veto =
            ready?.veto ?? ((m.phase === "veto" || m.phase === "starting") && m.veto?.matchId === result.matchId ? m.veto : null);
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
    // The socket outlives pages. When it is already open the connect replay is gone, so ask for it again
    if (rt.state === "open") rt.send("resync", {});
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
          if (!live || !cur || ENDED.has(cur.status)) return;
          setMatch((m) => (m.phase === "none" ? { phase: "starting", matchId: cur.id, slug: cur.slug, mode: cur.mode, status: cur.status } : m));
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
