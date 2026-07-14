import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../api/types";

const profileA: ConnectionProfile = {
  id: "A",
  name: "a",
  endpointUrl: "http://localhost:4566",
  region: "ap-northeast-1",
  accessKeyId: "x",
  secretAccessKey: "y",
};
const profileB: ConnectionProfile = { ...profileA, id: "B", name: "b" };

let activeProfile: ConnectionProfile | null = profileA;

vi.mock("../state/connections", () => ({
  useConnections: () => ({ active: activeProfile }),
}));

vi.mock("../api/client", () => ({
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "message" in e
      ? (e as { kind: string; message: string })
      : { kind: "internal", message: String(e) },
}));

import { useProfileScopedFetch } from "./useProfileScopedFetch";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useProfileScopedFetch", () => {
  beforeEach(() => {
    activeProfile = profileA;
  });

  it("fetches on mount", async () => {
    const fetcher = vi.fn(async (p: ConnectionProfile) => `data-${p.id}`);
    const { result } = renderHook(() => useProfileScopedFetch(fetcher));
    await waitFor(() => expect(result.current.data).toBe("data-A"));
    expect(fetcher).toHaveBeenCalledWith(profileA);
  });

  it("refetches when the active profile changes", async () => {
    const fetcher = vi.fn(async (p: ConnectionProfile) => `data-${p.id}`);
    const { result, rerender } = renderHook(() => useProfileScopedFetch(fetcher));
    await waitFor(() => expect(result.current.data).toBe("data-A"));

    activeProfile = profileB;
    rerender();
    await waitFor(() => expect(result.current.data).toBe("data-B"));
    expect(fetcher).toHaveBeenCalledWith(profileB);
  });

  it("discards a stale response from a previous profile", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const fetcher = vi.fn((p: ConnectionProfile) => (p.id === "A" ? slow.promise : fast.promise));

    const { result, rerender } = renderHook(() => useProfileScopedFetch(fetcher));

    // Switch to B before A resolves.
    activeProfile = profileB;
    rerender();

    await act(async () => {
      fast.resolve("data-B");
    });
    await waitFor(() => expect(result.current.data).toBe("data-B"));

    // A resolves late — must be ignored.
    await act(async () => {
      slow.resolve("data-A");
    });
    expect(result.current.data).toBe("data-B");
  });

  it("reload refetches", async () => {
    const fetcher = vi.fn(async (p: ConnectionProfile) => `data-${p.id}`);
    const { result } = renderHook(() => useProfileScopedFetch(fetcher));
    await waitFor(() => expect(result.current.data).toBe("data-A"));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.reload();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("converts a thrown value into an AppError", async () => {
    const fetcher = vi.fn(async () => {
      throw { kind: "not_found", message: "見つかりません" };
    });
    const { result } = renderHook(() => useProfileScopedFetch(fetcher));
    await waitFor(() => expect(result.current.error).toEqual({ kind: "not_found", message: "見つかりません" }));
    expect(result.current.data).toBeNull();
  });
});
