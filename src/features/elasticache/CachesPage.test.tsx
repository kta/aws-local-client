import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { CacheSummary } from "../../api/elasticache";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "ministack",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

const listCaches = vi.fn();
const createCache = vi.fn();
const deleteCache = vi.fn();

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    elasticache: {
      listCaches: (...args: unknown[]) => listCaches(...args),
      createCache: (...args: unknown[]) => createCache(...args),
      deleteCache: (...args: unknown[]) => deleteCache(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const cache = (id: string, kind: CacheSummary["kind"] = "replicationGroup"): CacheSummary => ({
  id,
  kind,
  engine: kind === "cacheCluster" ? "memcached" : "redis",
  status: "available",
  nodeType: "cache.t3.micro",
  numNodes: 1,
  endpoint: "localhost:6379",
});

import { ConnectionsProvider } from "../../state/connections";
import { CachesPage } from "./CachesPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/elasticache/caches"]}>
      <ConnectionsProvider>
        <CachesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  noProfiles = false;
});

describe("CachesPage list (R68/R69)", () => {
  beforeEach(() => {
    listCaches.mockReset().mockResolvedValue([cache("redis-1"), cache("mc-1", "cacheCluster")]);
    createCache.mockReset().mockResolvedValue(undefined);
    deleteCache.mockReset().mockResolvedValue(undefined);
  });

  it("renders caches with endpoint and status", async () => {
    renderPage();
    expect(await screen.findByTestId("cache-row-redis-1")).toBeInTheDocument();
    expect(screen.getByTestId("cache-row-mc-1")).toBeInTheDocument();
    expect(screen.getAllByText("localhost:6379").length).toBeGreaterThan(0);
    expect(screen.getByTestId("caches-create")).toBeInTheDocument();
  });

  it("creates a redis replication group via the modal", async () => {
    renderPage();
    await screen.findByTestId("cache-row-redis-1");

    fireEvent.click(screen.getByTestId("caches-create"));
    fireEvent.change(screen.getByTestId("c-id"), { target: { value: "new-redis" } });
    fireEvent.click(screen.getByTestId("c-save"));

    await waitFor(() =>
      expect(createCache).toHaveBeenCalledWith(
        profiles[0],
        expect.objectContaining({
          id: "new-redis",
          engine: "redis",
          nodeType: "cache.t3.micro",
          numNodes: 1,
        }),
      ),
    );
  });

  it("creates a memcached cache cluster when engine is memcached", async () => {
    renderPage();
    await screen.findByTestId("cache-row-redis-1");

    fireEvent.click(screen.getByTestId("caches-create"));
    fireEvent.change(screen.getByTestId("c-id"), { target: { value: "new-mc" } });
    fireEvent.change(screen.getByTestId("c-engine"), { target: { value: "memcached" } });
    fireEvent.click(screen.getByTestId("c-save"));

    await waitFor(() =>
      expect(createCache).toHaveBeenCalledWith(
        profiles[0],
        expect.objectContaining({ id: "new-mc", engine: "memcached" }),
      ),
    );
  });

  it("confirms deletion via the id-typed modal and routes by kind", async () => {
    renderPage();
    await screen.findByTestId("cache-row-mc-1");

    // Delete the memcached cluster row (second row).
    fireEvent.click(screen.getAllByTestId("caches-delete")[1]);
    const confirm = screen.getByTestId("caches-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("caches-delete-input"), { target: { value: "mc-1" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteCache).toHaveBeenCalledWith(profiles[0], "mc-1", "cacheCluster"),
    );
  });
});

describe("CachesPage unsupported (R70)", () => {
  beforeEach(() => {
    listCaches
      .mockReset()
      .mockRejectedValue(
        new Error("API for service 'elasticache' not yet implemented or pro feature"),
      );
    createCache.mockReset();
  });

  it("shows the unsupported banner and hides the create button", async () => {
    renderPage();
    expect(await screen.findByTestId("elasticache-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("caches-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});

describe("CachesPage create failure (R69)", () => {
  beforeEach(() => {
    listCaches.mockReset().mockResolvedValue([cache("redis-1")]);
    createCache.mockReset().mockRejectedValue(new Error("InvalidParameterValue"));
  });

  it("shows a normal error banner, not the unsupported banner", async () => {
    renderPage();
    await screen.findByTestId("cache-row-redis-1");

    fireEvent.click(screen.getByTestId("caches-create"));
    fireEvent.change(screen.getByTestId("c-id"), { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("c-save"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("elasticache-unsupported")).not.toBeInTheDocument();
    expect(screen.getByTestId("cache-row-redis-1")).toBeInTheDocument();
  });
});

describe("CachesPage without an active connection", () => {
  beforeEach(() => {
    noProfiles = true;
    listCaches.mockReset().mockResolvedValue([cache("redis-1")]);
  });

  it("shows the connection-required prompt and never lists caches", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(screen.queryByTestId("caches-heading")).not.toBeInTheDocument();
    expect(listCaches).not.toHaveBeenCalled();
  });
});
