"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyRoomEvent, isRoomOver, mergeRoomDetail, roomFromDetail, roomStage, type RoomEvent, type RoomState } from "@rushsite/shared";
import { api } from "./api";
import { useSession } from "./session";
import type { MatchDetail, MatchUpdate } from "./types";
import { useVisibleInterval } from "./useVisibleInterval";
import { getRealtime } from "./ws";

// Signed out viewers have no socket, so the room polls instead
export const MATCH_POLL_MS = 5000;

// Scores and rounds from match_update. Player stats come with the next refetch
function applyUpdate(m: MatchDetail, u: MatchUpdate): MatchDetail {
  const rounds = u.lastRound && !m.rounds.some((r) => r.round === u.lastRound!.round && r.mapNumber === u.lastRound!.mapNumber) ? [...m.rounds, u.lastRound] : m.rounds;
  return {
    ...m,
    status: u.status,
    teams: u.teams.length > 0 ? m.teams.map((t) => ({ ...t, score: u.teams.find((x) => x.name === t.name)?.score ?? t.score })) : m.teams,
    rounds,
    ...(u.maps ? { maps: u.maps.map((x) => ({ ...x, players: m.maps?.find((y) => y.mapNumber === x.mapNumber)?.players })) } : {}),
  };
}

// Everything the match room shows. REST loads it, the socket keeps it current and a reconnect refetches it
export function useMatchRoom(idOrSlug: string) {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const matchId = detail?.id ?? null;
  const roomRef = useRef<RoomState | null>(null);
  roomRef.current = room;

  const take = useCallback((m: MatchDetail) => {
    setDetail((cur) => (cur && cur.id === m.id && cur.rounds.length > m.rounds.length && !isRoomOver(m.status) ? cur : m));
    setRoom((r) => (r && r.matchId === m.id ? mergeRoomDetail(r, m) : roomFromDetail(m)));
  }, []);

  const reload = useCallback(() => {
    api.match(idOrSlug).then(take, () => undefined);
  }, [idOrSlug, take]);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setRoom(null);
    setError(null);
    api.match(idOrSlug).then(
      (m) => live && take(m),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [idOrSlug, take]);

  useEffect(() => {
    if (!signedIn || !matchId) return;
    const rt = getRealtime();
    rt.connect();
    const subscribe = () => rt.send("subscribe_match", { matchId });
    subscribe();
    const push = (e: RoomEvent) => setRoom((r) => (r ? applyRoomEvent(r, e) : r));
    let refetch: ReturnType<typeof setTimeout> | undefined;
    // Stats, extras and demos only come over REST
    const later = () => {
      clearTimeout(refetch);
      refetch = setTimeout(reload, 400);
    };
    let wasOpen = rt.state === "open";
    const offs = [
      rt.onState((s) => {
        if (s !== "open") {
          wasOpen = false;
          return;
        }
        subscribe();
        // Messages sent while the socket was down are gone, so take a fresh snapshot
        if (!wasOpen) reload();
        wasOpen = true;
      }),
      rt.on("match_found", (payload) => push({ type: "match_found", payload })),
      rt.on("veto_state", (payload) => push({ type: "veto_state", payload })),
      rt.on("server_ready", (payload) => push({ type: "server_ready", payload })),
      rt.on("match_result", (payload) => {
        push({ type: "match_result", payload });
        if (payload.matchId === matchId) later();
      }),
      rt.on("match_cancelled", (payload) => push({ type: "match_cancelled", payload })),
      rt.on("match_update", (payload) => {
        if (payload.matchId !== matchId) return;
        push({ type: "match_update", payload });
        setDetail((m) => (m ? applyUpdate(m, payload) : m));
        if (payload.maps) later();
      }),
    ];
    return () => {
      clearTimeout(refetch);
      offs.forEach((off) => off());
      rt.send("unsubscribe_match", { matchId });
    };
  }, [matchId, signedIn, reload]);

  // No socket message covers the server start, so a waiting room also polls
  const stage = room ? roomStage(room) : null;
  const polling = !loading && !!room && !isRoomOver(room.status) && (!signedIn || stage === "allocating");
  useVisibleInterval(reload, MATCH_POLL_MS, polling);

  const respond = useCallback(
    (accept: boolean) => {
      const r = roomRef.current;
      if (!r) return;
      // The REST route covers a socket that is still reconnecting
      if (!getRealtime().send("accept_match", { matchId: r.matchId, accept })) {
        api.post(`/matches/${r.matchId}/accept`, { accept }).catch(() => undefined);
      }
      setRoom((cur) => (cur ? applyRoomEvent(cur, { type: "responded", payload: { matchId: cur.matchId } }) : cur));
    },
    [],
  );

  const vote = useCallback((mapId: string) => {
    const r = roomRef.current;
    if (r && !getRealtime().send("veto_vote", { matchId: r.matchId, mapId })) {
      api.post(`/matches/${r.matchId}/veto`, { mapId }).catch(() => undefined);
    }
  }, []);

  return { detail, room, stage, error, respond, vote, reload };
}
