import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { MskClusterSummary } from "../../api/msk";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "floci",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

const listClusters = vi.fn();
const createCluster = vi.fn();
const deleteCluster = vi.fn();

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    msk: {
      listClusters: (...args: unknown[]) => listClusters(...args),
      createCluster: (...args: unknown[]) => createCluster(...args),
      deleteCluster: (...args: unknown[]) => deleteCluster(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const cluster = (name: string): MskClusterSummary => ({
  arn: `arn:aws:kafka:us-east-1:000000000000:cluster/${name}/x`,
  name,
  state: "ACTIVE",
  numberOfBrokerNodes: 1,
  kafkaVersion: "3.6.0",
});

import { ConnectionsProvider } from "../../state/connections";
import { ClustersPage } from "./ClustersPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/msk/clusters"]}>
      <ConnectionsProvider>
        <ClustersPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  noProfiles = false;
});

describe("ClustersPage list (R92)", () => {
  beforeEach(() => {
    listClusters.mockReset().mockResolvedValue([cluster("c1")]);
    createCluster.mockReset().mockResolvedValue(undefined);
    deleteCluster.mockReset().mockResolvedValue(undefined);
  });

  it("renders clusters with broker count and version", async () => {
    renderPage();
    expect(await screen.findByTestId("cluster-row-c1")).toBeInTheDocument();
    expect(screen.getByText("3.6.0")).toBeInTheDocument();
    expect(screen.getByTestId("msk-create")).toBeInTheDocument();
  });

  it("creates a cluster via the modal", async () => {
    renderPage();
    await screen.findByTestId("cluster-row-c1");

    fireEvent.click(screen.getByTestId("msk-create"));
    fireEvent.change(screen.getByTestId("c-name"), { target: { value: "new-cluster" } });
    fireEvent.change(screen.getByTestId("c-brokers"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("c-save"));

    await waitFor(() =>
      expect(createCluster).toHaveBeenCalledWith(profiles[0], "new-cluster", 2),
    );
  });

  it("confirms deletion via the name-typed modal", async () => {
    renderPage();
    await screen.findByTestId("cluster-row-c1");

    fireEvent.click(screen.getByTestId("msk-delete"));
    const confirm = screen.getByTestId("msk-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("msk-delete-input"), { target: { value: "c1" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteCluster).toHaveBeenCalledWith(profiles[0], cluster("c1").arn),
    );
  });
});

describe("ClustersPage unsupported (R93)", () => {
  beforeEach(() => {
    listClusters
      .mockReset()
      .mockRejectedValue(new Error("API for service 'kafka' not yet implemented or pro feature"));
    createCluster.mockReset();
    deleteCluster.mockReset();
  });

  it("shows the unsupported banner and hides the create button", async () => {
    renderPage();
    expect(await screen.findByTestId("msk-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("msk-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});

describe("ClustersPage create failure", () => {
  beforeEach(() => {
    listClusters.mockReset().mockResolvedValue([cluster("c1")]);
    // A create error that is NOT an unsupported signature stays a normal banner.
    createCluster.mockReset().mockRejectedValue(new Error("LimitExceededException"));
    deleteCluster.mockReset();
  });

  it("shows a normal error banner, not the unsupported banner", async () => {
    renderPage();
    await screen.findByTestId("cluster-row-c1");

    fireEvent.click(screen.getByTestId("msk-create"));
    fireEvent.change(screen.getByTestId("c-name"), { target: { value: "boom" } });
    fireEvent.click(screen.getByTestId("c-save"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("msk-unsupported")).not.toBeInTheDocument();
    expect(screen.getByTestId("cluster-row-c1")).toBeInTheDocument();
  });
});

describe("ClustersPage without an active connection", () => {
  beforeEach(() => {
    noProfiles = true;
    listClusters.mockReset().mockResolvedValue([cluster("c1")]);
  });

  it("shows the connection-required prompt and never lists clusters", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(screen.queryByTestId("clusters-heading")).not.toBeInTheDocument();
    expect(listClusters).not.toHaveBeenCalled();
  });
});
