"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import { resetRealtime, setRealtimeAllowed } from "./ws";
import type { User } from "./types";

type Session = { user: User | null; loading: boolean; refresh: () => void; signOut: () => Promise<void> };

const SessionContext = createContext<Session>({
  user: null,
  loading: true,
  refresh: () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .me()
      .then(
        (u) => {
          setUser(u);
          // The socket only opens for a confirmed session. A closed session re-checks here
          setRealtimeAllowed(!!u, refresh);
        },
        (e: unknown) => {
          setUser(null);
          setRealtimeAllowed(false);
          if (e instanceof ApiError && e.status === 403 && e.code === "banned") showBanned(e.details);
        },
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setRealtimeAllowed(false);
      resetRealtime();
    }
  }, []);

  return <SessionContext.Provider value={{ user, loading, refresh, signOut }}>{children}</SessionContext.Provider>;
}

function showBanned(details: unknown) {
  if (typeof window === "undefined" || window.location.pathname === "/banned") return;
  const d = (details ?? {}) as { reason?: string; until?: string | null };
  const q = new URLSearchParams({ until: d.until ?? "", reason: d.reason ?? "" });
  if (d.until === null) q.set("permanent", "1");
  window.location.assign(`/banned?${q.toString()}`);
}

export function useSession(): Session {
  return useContext(SessionContext);
}
