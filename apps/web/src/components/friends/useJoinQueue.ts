"use client";

import { useCallback, useEffect, useState } from "react";
import { type Mode, type PartyUpdatePayload, type QueueStatusPayload } from "@rushsite/shared";
import { modeUnavailable, useServiceStatus } from "@/components/stats/useServiceStatus";
import { api } from "@/lib/api";
import { getRealtime } from "@/lib/ws";

export type JoinableModes = (modes: readonly Mode[]) => Mode[];

// Link that selects the modes on /play and starts the queue
export function joinQueueHref(modes: readonly Mode[]): string {
  return `/play?modes=${modes.join(",")}&start=1`;
}

// Which of a friend's queued modes the viewer may join. Empty unless the viewer is solo and idle.
// Pass ready when the page already knows the viewer's party and queue state
export function useJoinableModes({ ready, enabled = true }: { ready?: boolean; enabled?: boolean } = {}): JoinableModes {
  const [party, setParty] = useState<PartyUpdatePayload | null>(null);
  const [queue, setQueue] = useState<QueueStatusPayload | null>(null);
  const known = ready !== undefined || !enabled;
  const service = useServiceStatus();

  useEffect(() => {
    if (known) return;
    const rt = getRealtime();
    rt.connect();
    const offs = [rt.on("queue_status", setQueue), rt.on("party_update", setParty)];
    let live = true;
    Promise.allSettled([api.queueStatus(), api.party.get()]).then(([q, p]) => {
      if (!live) return;
      if (q.status === "fulfilled") setQueue(q.value);
      if (p.status === "fulfilled") setParty(p.value);
    });
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [known]);

  const solo = !party?.partyId || party.members.length <= 1;
  const idle = queue !== null && queue.state === "idle";
  const allowed = enabled && (ready ?? (solo && idle));

  return useCallback(
    (modes) => (allowed ? modes.filter((m) => !modeUnavailable(service, m)) : []),
    [allowed, service],
  );
}
