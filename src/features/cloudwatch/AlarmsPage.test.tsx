import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AlarmSummary } from "../../api/cloudwatch";
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

const sampleAlarms: AlarmSummary[] = [
  {
    name: "cpu-high",
    state: "OK",
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    threshold: 80,
    comparisonOperator: "GreaterThanThreshold",
    statistic: "Average",
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    cloudwatch: {
      describeAlarms: (...args: unknown[]) => describeAlarms(...args),
      putMetricAlarm: (...args: unknown[]) => putMetricAlarm(...args),
      deleteAlarms: (...args: unknown[]) => deleteAlarms(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const describeAlarms = vi.fn();
const putMetricAlarm = vi.fn();
const deleteAlarms = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { AlarmsPage } from "./AlarmsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudwatch/alarms"]}>
      <ConnectionsProvider>
        <AlarmsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  describeAlarms.mockReset().mockResolvedValue(sampleAlarms);
  putMetricAlarm.mockReset().mockResolvedValue(undefined);
  deleteAlarms.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AlarmsPage", () => {
  it("renders alarm rows with state and metric", async () => {
    renderPage();
    expect(await screen.findByText("cpu-high")).toBeInTheDocument();
    expect(screen.getByText("CPUUtilization")).toBeInTheDocument();
  });

  it("creates an alarm and reloads the list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("alarm-create"));
    fireEvent.change(await screen.findByTestId("alarm-name"), { target: { value: "mem-high" } });
    fireEvent.change(screen.getByTestId("alarm-namespace"), { target: { value: "AWS/EC2" } });
    fireEvent.change(screen.getByTestId("alarm-metric"), { target: { value: "MemUsage" } });
    fireEvent.change(screen.getByTestId("alarm-threshold"), { target: { value: "90" } });
    fireEvent.click(screen.getByTestId("alarm-save"));
    await waitFor(() =>
      expect(putMetricAlarm).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ name: "mem-high", namespace: "AWS/EC2", metricName: "MemUsage" }),
      ),
    );
    await waitFor(() => expect(describeAlarms).toHaveBeenCalledTimes(2));
  });

  it("deletes an alarm after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("cpu-high を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("alarm-delete"));
    const confirm = screen.getByTestId("alarm-delete-confirm");
    fireEvent.change(screen.getByTestId("alarm-delete-input"), { target: { value: "cpu-high" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteAlarms).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), ["cpu-high"]),
    );
  });

  it("shows the cloudwatch-unsupported banner when the API is unsupported", async () => {
    describeAlarms.mockRejectedValue({ kind: "internal", message: "Unknown service: monitoring" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cloudwatch-unsupported")).toBeInTheDocument());
    expect(screen.queryByTestId("alarm-create")).not.toBeInTheDocument();
  });

  it("shows the error banner for a non-unsupported failure", async () => {
    describeAlarms.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("cloudwatch-unsupported")).not.toBeInTheDocument();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(describeAlarms).not.toHaveBeenCalled();
  });
});
