import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

let noProfiles = false;

const listClusters = vi.fn();
const createCluster = vi.fn();
const deleteCluster = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    ecs: {
      listClusters: (...args: unknown[]) => listClusters(...args),
      createCluster: (...args: unknown[]) => createCluster(...args),
      deleteCluster: (...args: unknown[]) => deleteCluster(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const sample: ClusterSummary[] = [
  {
    name: "web",
    arn: "arn:aws:ecs:::cluster/web",
    status: "ACTIVE",
    activeServicesCount: 1,
    runningTasksCount: 2,
    pendingTasksCount: 0,
    registeredContainerInstancesCount: 0,
  },
];

import { ConnectionsProvider } from "../../state/connections";
import { ClustersPage } from "./ClustersPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/ecs/clusters"]}>
      <ConnectionsProvider>
        <ClustersPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  noProfiles = false;
  listClusters.mockReset().mockResolvedValue(sample);
  createCluster.mockReset().mockResolvedValue(undefined);
  deleteCluster.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("ECS ClustersPage (R75)", () => {
  it("lists clusters with status and counts", async () => {
    renderPage();
    expect(await screen.findByTestId("ecs-cluster-row-web")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("creates a cluster and reloads", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-cluster-create"));
    fireEvent.change(await screen.findByTestId("ecs-cluster-name"), {
      target: { value: "new-cluster" },
    });
    fireEvent.click(screen.getByTestId("ecs-cluster-save"));
    await waitFor(() =>
      expect(createCluster).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-cluster",
      ),
    );
    await waitFor(() => expect(listClusters).toHaveBeenCalledTimes(2));
  });

  it("deletes a cluster after typing its name", async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText("web を選択"));
    fireEvent.click(screen.getByTestId("ecs-cluster-delete"));
    const confirm = screen.getByTestId("ecs-cluster-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("ecs-cluster-delete-input"), { target: { value: "web" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteCluster).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "web"),
    );
  });

  it("shows the ecs-unsupported banner and hides create when unsupported", async () => {
    listClusters.mockRejectedValue(new Error("API for service 'ecs' not yet implemented"));
    renderPage();
    expect(await screen.findByTestId("ecs-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("ecs-cluster-create")).not.toBeInTheDocument();
  });

  it("shows a generic error banner for non-unsupported errors", async () => {
    listClusters.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("ecs-unsupported")).not.toBeInTheDocument();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listClusters).not.toHaveBeenCalled();
  });
});
