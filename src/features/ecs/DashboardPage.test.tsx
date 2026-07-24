import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ClusterSummary } from "../../api/ecs";
import type { ConnectionProfile } from "../../api/types";

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

// Backed by a plain swappable implementation rather than a vi.fn: when a mock
// created with vi.fn resolves its rejection deep inside the async
// ConnectionsProvider -> useProfileScopedFetch chain, Vitest's per-call result
// tracking observes the rejection one tick too late and surfaces it as an
// unhandled rejection, flaking this (single-fetch) dashboard even though the
// production code always catches it. A plain function has no such tracking.
// These tests assert on rendered output, not call counts, so vi.fn is not needed.
let listClustersImpl: (profile: ConnectionProfile) => Promise<ClusterSummary[]>;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: async () => profiles,
    ecs: {
      listClusters: (profile: ConnectionProfile) => listClustersImpl(profile),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const cluster = (name: string, services: number, tasks: number): ClusterSummary => ({
  name,
  arn: `arn:aws:ecs:::cluster/${name}`,
  status: "ACTIVE",
  activeServicesCount: services,
  runningTasksCount: tasks,
  pendingTasksCount: 0,
  registeredContainerInstancesCount: 0,
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/ecs"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("ECS DashboardPage (R75)", () => {
  beforeEach(() => {
    listClustersImpl = async () => [];
  });

  it("shows cluster/service/task summary counts", async () => {
    listClustersImpl = async () => [cluster("web", 2, 3), cluster("api", 1, 1)];
    renderPage();
    await waitFor(() => expect(screen.getByTestId("ecs-dash-clusters")).toHaveTextContent("2"));
    expect(screen.getByTestId("ecs-dash-services")).toHaveTextContent("3");
    expect(screen.getByTestId("ecs-dash-tasks")).toHaveTextContent("4");
  });

  it("shows the ecs-unsupported banner when clusters are unsupported", async () => {
    listClustersImpl = () =>
      Promise.reject(new Error("API for service 'ecs' not yet implemented"));
    renderPage();
    expect(await screen.findByTestId("ecs-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("ecs-dash-create")).not.toBeInTheDocument();
  });
});
