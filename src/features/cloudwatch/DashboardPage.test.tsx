import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AlarmSummary, LogGroup } from "../../api/cloudwatch";
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

const sampleGroups: LogGroup[] = [
  { name: "/nlsd/app", retentionInDays: 7, storedBytes: 2048, createdAt: null },
];
const sampleAlarms: AlarmSummary[] = [
  {
    name: "a1",
    state: "OK",
    metricName: "m",
    namespace: "ns",
    threshold: 1,
    comparisonOperator: "GreaterThanThreshold",
    statistic: "Average",
  },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cloudwatch: {
      listLogGroups: (...args: unknown[]) => listLogGroups(...args),
      describeAlarms: (...args: unknown[]) => describeAlarms(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listLogGroups = vi.fn();
const describeAlarms = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudwatch"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listLogGroups.mockReset().mockResolvedValue(sampleGroups);
  describeAlarms.mockReset().mockResolvedValue(sampleAlarms);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("cloudwatch DashboardPage", () => {
  it("summarises log-group and alarm counts", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cw-dash-log-groups")).toHaveTextContent("1"));
    await waitFor(() => expect(screen.getByTestId("cw-dash-alarms")).toHaveTextContent("1"));
  });

  it("shows '-' for alarm count when the alarms API is unsupported", async () => {
    describeAlarms.mockRejectedValue({ kind: "internal", message: "Unknown service: monitoring" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cw-dash-log-groups")).toHaveTextContent("1"));
    expect(screen.getByTestId("cw-dash-alarms")).toHaveTextContent("-");
  });
});
