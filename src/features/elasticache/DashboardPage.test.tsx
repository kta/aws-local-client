import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    elasticache: {
      listCaches: (...args: unknown[]) => listCaches(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const cache = (id: string, engine: string, kind: CacheSummary["kind"]): CacheSummary => ({
  id,
  kind,
  engine,
  status: "available",
  nodeType: "cache.t3.micro",
  numNodes: 1,
  endpoint: "localhost:6379",
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/elasticache"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("ElastiCache DashboardPage (R68)", () => {
  beforeEach(() => {
    listCaches.mockReset();
  });

  it("shows total and per-engine breakdown counts", async () => {
    listCaches.mockResolvedValue([
      cache("r1", "redis", "replicationGroup"),
      cache("v1", "valkey", "replicationGroup"),
      cache("m1", "memcached", "cacheCluster"),
      cache("m2", "memcached", "cacheCluster"),
    ]);

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("elasticache-dash-total")).toHaveTextContent("4"),
    );
    expect(screen.getByTestId("elasticache-dash-redis")).toHaveTextContent("1");
    expect(screen.getByTestId("elasticache-dash-valkey")).toHaveTextContent("1");
    expect(screen.getByTestId("elasticache-dash-memcached")).toHaveTextContent("2");
  });

  it("shows the elasticache-unsupported banner when describe is unsupported", async () => {
    listCaches.mockRejectedValue(
      new Error("API for service 'elasticache' not yet implemented or pro feature"),
    );

    renderPage();

    expect(await screen.findByTestId("elasticache-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("elasticache-dash-create")).not.toBeInTheDocument();
  });
});
