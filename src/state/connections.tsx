import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ConnectionProfile } from "../api/types";

const STORAGE_KEY = "nlsd.activeConnectionId";

type Ctx = {
  profiles: ConnectionProfile[];
  active: ConnectionProfile | null;
  setActiveId: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
};

const ConnectionsContext = createContext<Ctx | null>(null);

export function ConnectionsProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await api.listConnections());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setActiveIdState(id);
  }, []);

  const active = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null,
    [profiles, activeId],
  );

  return (
    <ConnectionsContext.Provider value={{ profiles, active, setActiveId, refresh, loading }}>
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections(): Ctx {
  const ctx = useContext(ConnectionsContext);
  if (!ctx) throw new Error("useConnections must be used within ConnectionsProvider");
  return ctx;
}
