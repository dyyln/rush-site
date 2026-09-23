"use client";

import { useEffect, useState } from "react";
import type { Mode, ServiceStatus } from "@rushsite/shared";
import { unavailableText } from "./copy";
import { statsApi } from "./statsApi";

const REFRESH_MS = 60_000;

// Polls GET /status. Keeps the last good answer on errors
export function useServiceStatus(refreshMs = REFRESH_MS): ServiceStatus | null {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      statsApi.status().then(
        (s) => live && setStatus(s),
        () => undefined,
      );
    void load();
    const t = setInterval(load, refreshMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [refreshMs]);
  return status;
}

// Short reason text when the mode cannot queue, null when it can
export function modeUnavailable(status: ServiceStatus | null, mode: Mode): string | null {
  const m = status?.modes.find((x) => x.mode === mode);
  return m && !m.available ? unavailableText(m.reason) : null;
}
