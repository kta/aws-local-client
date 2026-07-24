import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { BootstrapBrokers, MskClusterSummary } from "../../api/msk";

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
const describeCluster = vi.fn();
const getBootstrapBrokers = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    msk: {
      listClusters: (...args: unknown[]) => listClusters(...args),
      describeCluster: (...args: unknown[]) => describeCluster(...args),
      getBootstrapBrokers: (...args: unknown[]) => getBootstrapBrokers(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const summary: MskClusterSummary = {
  arn: "arn:aws:kafka:us-east-1:000000000000:cluster/c1/x",
  name: "c1",
  state: "ACTIVE",
  numberOfBrokerNodes: 1,
  kafkaVersion: "3.6.0",
};

import { ConnectionsProvider } from "../../state/connections";
import { ClusterDetailPage } from "./ClusterDetailPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/msk/clusters/c1"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/msk/clusters/:name" element={<ClusterDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("ClusterDetailPage (R92)", () => {
  beforeEach(() => {
    listClusters.mockReset().mockResolvedValue([summary]);
    describeCluster.mockReset().mockResolvedValue(summary);
    getBootstrapBrokers.mockReset();
  });

  it("shows the plaintext bootstrap broker string and copies it", async () => {
    getBootstrapBrokers.mockResolvedValue({
      plaintext: "b-1:9092",
      tls: null,
    } as BootstrapBrokers);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage();

    expect(await screen.findByTestId("msk-bootstrap-plaintext")).toHaveTextContent("b-1:9092");
    fireEvent.click(screen.getByTestId("msk-copy-brokers"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("b-1:9092"));
  });

  it("shows the TLS broker string when present", async () => {
    getBootstrapBrokers.mockResolvedValue({
      plaintext: "b-1:9092",
      tls: "b-1:9094",
    } as BootstrapBrokers);
    renderPage();
    expect(await screen.findByTestId("msk-bootstrap-tls")).toHaveTextContent("b-1:9094");
  });
});
