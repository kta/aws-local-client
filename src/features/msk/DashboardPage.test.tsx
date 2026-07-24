import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    msk: {
      listClusters: (...args: unknown[]) => listClusters(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const cluster = (name: string, state: string): MskClusterSummary => ({
  arn: `arn:aws:kafka:us-east-1:000000000000:cluster/${name}/x`,
  name,
  state,
  numberOfBrokerNodes: 1,
  kafkaVersion: "3.6.0",
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/msk"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("MSK DashboardPage (R92)", () => {
  beforeEach(() => {
    listClusters.mockReset();
  });

  it("shows cluster/active summary counts", async () => {
    listClusters.mockResolvedValue([cluster("c1", "ACTIVE"), cluster("c2", "CREATING")]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("msk-dash-clusters")).toHaveTextContent("2"));
    expect(screen.getByTestId("msk-dash-active")).toHaveTextContent("1");
    expect(screen.getByTestId("msk-dash-create")).toBeInTheDocument();
  });

  it("shows the msk-unsupported banner when the API is unsupported (R93)", async () => {
    listClusters.mockRejectedValue(
      new Error("API for service 'kafka' not yet implemented or pro feature"),
    );
    renderPage();
    expect(await screen.findByTestId("msk-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("msk-dash-create")).not.toBeInTheDocument();
  });
});
