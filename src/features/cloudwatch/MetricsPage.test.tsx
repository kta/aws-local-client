import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Datapoint, MetricSummary } from "../../api/cloudwatch";
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

const sampleMetrics: MetricSummary[] = [
  { namespace: "NLSD/E2E", name: "Probe", dimensions: [{ name: "Host", value: "h1" }] },
  { namespace: "AWS/EC2", name: "CPUUtilization", dimensions: [] },
];

const samplePoints: Datapoint[] = [{ timestamp: "2026-07-22T05:00:00Z", value: 42 }];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    cloudwatch: {
      listMetrics: (...args: unknown[]) => listMetrics(...args),
      getMetricStatistics: (...args: unknown[]) => getMetricStatistics(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listMetrics = vi.fn();
const getMetricStatistics = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { MetricsPage } from "./MetricsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudwatch/metrics"]}>
      <ConnectionsProvider>
        <MetricsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listMetrics.mockReset().mockResolvedValue(sampleMetrics);
  getMetricStatistics.mockReset().mockResolvedValue(samplePoints);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MetricsPage", () => {
  it("lists metrics for the default namespace and loads statistics on selection", async () => {
    renderPage();
    // The first namespace (AWS/EC2, sorted) is auto-selected.
    expect(await screen.findByTestId("metric-link-CPUUtilization")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("metric-link-CPUUtilization"));
    await waitFor(() => expect(getMetricStatistics).toHaveBeenCalled());
    expect(await screen.findByText("42")).toBeInTheDocument();
  });

  it("filters metrics by the selected namespace", async () => {
    renderPage();
    // Wait for metrics to load (default namespace AWS/EC2 shows CPUUtilization).
    await screen.findByTestId("metric-link-CPUUtilization");
    fireEvent.change(screen.getByTestId("metrics-namespace-select"), {
      target: { value: "NLSD/E2E" },
    });
    expect(await screen.findByTestId("metric-link-Probe")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-link-CPUUtilization")).not.toBeInTheDocument();
  });

  it("shows the cloudwatch-unsupported banner when metrics are unsupported", async () => {
    listMetrics.mockRejectedValue({ kind: "internal", message: "Unknown service: monitoring" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cloudwatch-unsupported")).toBeInTheDocument());
    expect(screen.queryByTestId("metrics-namespace-select")).not.toBeInTheDocument();
  });

  it("shows the error banner for a non-unsupported failure", async () => {
    listMetrics.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("cloudwatch-unsupported")).not.toBeInTheDocument();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listMetrics).not.toHaveBeenCalled();
  });
});
