import { useCallback, useEffect, useRef, useState } from "react";
import { toAppError } from "../api/client";
import type { AppError, ConnectionProfile } from "../api/types";
import { useConnections } from "../state/connections";

export interface ProfileScopedFetch<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  reload: () => Promise<void>; // wire directly to ErrorBanner onRetry
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Active-profile-scoped fetch (§2.13). Refetches when the active connection (or
 * any extra dep) changes, converts thrown values via toAppError, and discards
 * stale responses: each run bumps a request id and only the latest run commits
 * its result. `reload` is guarded so overlapping manual retries are ignored.
 */
export function useProfileScopedFetch<T>(
  fetcher: (profile: ConnectionProfile) => Promise<T>,
  deps: React.DependencyList = [],
): ProfileScopedFetch<T> {
  const { active } = useConnections();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const loadingRef = useRef(false);

  const run = useCallback(
    async (profile: ConnectionProfile) => {
      const id = ++requestId.current; // any older in-flight run is now stale
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher(profile);
        if (id === requestId.current) setData(result);
      } catch (e) {
        if (id === requestId.current) setError(toAppError(e));
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    // Mirror the per-page `load` pattern: depend on the caller-supplied deps,
    // not the inline fetcher (which is a fresh closure each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    if (!active) {
      requestId.current++; // invalidate any in-flight response
      setData(null);
      setError(null);
      setLoading(false);
      loadingRef.current = false;
      return;
    }
    void run(active);
  }, [active, run]);

  const reload = useCallback(async () => {
    if (!active) return;
    if (loadingRef.current) return; // onRetry guard: no overlapping reloads
    await run(active);
  }, [active, run]);

  return { data, error, loading, reload, setData };
}
