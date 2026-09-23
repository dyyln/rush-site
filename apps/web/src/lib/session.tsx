"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
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
      .then(setUser, () => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return <SessionContext.Provider value={{ user, loading, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
