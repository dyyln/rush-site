"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMock } from "@/lib/env";
import type { AdminEventPayload } from "@rushsite/shared";
import { getRealtime, type ConnectionState } from "@/lib/ws";
import { mockTick } from "./mock";
import type { AdminEventKind } from "./types";

type AdminEvent = AdminEventPayload;
type Listener = (e: AdminEvent) => void;

// In mock mode a local ticker stands in for the api's admin_event stream
const mockListeners = new Set<Listener>();
let mockTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMock() {
  mockTimer = setTimeout(() => {
    const e = mockTick();
    mockListeners.forEach((l) => l(e));
    scheduleMock();
  }, 2500 + Math.random() * 3000);
}

function subscribe(listener: Listener): () => void {
  if (isMock) {
    mockListeners.add(listener);
    if (!mockTimer) scheduleMock();
    return () => {
      mockListeners.delete(listener);
      if (mockListeners.size === 0 && mockTimer) {
        clearTimeout(mockTimer);
        mockTimer = null;
      }
    };
  }
  const rt = getRealtime();
  rt.connect();
  return rt.on("admin_event", listener);
}

// Calls onEvent for every admin_event whose kind is in kinds
export function useAdminEvents(kinds: readonly AdminEventKind[] | "all", onEvent: (e: AdminEvent) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const key = kinds === "all" ? "all" : kinds.join(",");
  useEffect(() => {
    const wanted = key === "all" ? null : new Set(key.split(","));
    return subscribe((e) => {
      if (!wanted || wanted.has(e.kind)) ref.current(e);
    });
  }, [key]);
}

export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(isMock ? "open" : "connecting");
  useEffect(() => {
    if (isMock) return;
    const rt = getRealtime();
    setState(rt.state);
    return rt.onState(setState);
  }, []);
  return state;
}

export type LiveData<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  reload: () => void;
};

// Loads data once, then reloads on matching admin events and on a slow poll as a fallback.
// Keeps the previous data while reloading so tables do not flash.
export function useLiveData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { kinds: readonly AdminEventKind[] | "all"; pollMs?: number },
): LiveData<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    const id = ++seq.current;
    setRefreshing(true);
    fetchRef.current().then(
      (d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(undefined);
        setUpdatedAt(Date.now());
        setRefreshing(false);
      },
      (e: unknown) => {
        if (id !== seq.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRefreshing(false);
      },
    );
  }, []);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const ms = opts.pollMs ?? 20_000;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, opts.pollMs]);

  useAdminEvents(opts.kinds, () => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(reload, 300);
  });

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  return { data, error, loading: data === undefined && !error, refreshing, updatedAt, reload };
}

// Ticks once a second for relative times
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
