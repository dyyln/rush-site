"use client";

import { useEffect } from "react";
import type { Mode } from "@rushsite/shared";
import { getRealtime } from "@/lib/ws";
import { fireCue } from "./cues";

// Listens on the shared realtime client without opening it. Pages that need live data connect it
export function NotifyListener() {
  useEffect(() => {
    const rt = getRealtime();
    const modes = new Map<string, Mode>();
    const fired = new Set<string>();
    const once = (key: string) => {
      if (fired.has(key)) return false;
      fired.add(key);
      return true;
    };
    const offs = [
      // match_found repeats as players accept. Only the first one per match alerts
      rt.on("match_found", (p) => {
        modes.set(p.matchId, p.mode);
        if (once(`found:${p.matchId}`)) fireCue("match_found", p.mode, p.matchId, p.acceptWindowSec);
      }),
      rt.on("server_ready", (p) => {
        if (once(`ready:${p.matchId}`)) fireCue("server_ready", modes.get(p.matchId) ?? null, p.matchId);
      }),
      // Queueing again starts a fresh match flow
      rt.on("queue_status", (p) => {
        if (p.state === "queued") fired.clear();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return null;
}
