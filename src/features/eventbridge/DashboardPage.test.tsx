import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { EventBusSummary } from "../../api/eventbridge";
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

const sampleBuses: EventBusSummary[] = [
  { name: "default", arn: "arn:aws:events:ap-northeast-1:000000000000:event-bus/default" },
  { name: "custom-bus", arn: "arn:aws:events:ap-northeast-1:000000000000:event-bus/custom-bus" },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    eventbridge: {
      listBuses: (...args: unknown[]) => listBuses(...args),
      listRules: (...args: unknown[]) => listRules(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listBuses = vi.fn();
const listRules = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/eventbridge"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listBuses.mockReset().mockResolvedValue(sampleBuses);
  listRules.mockReset().mockResolvedValue([{ name: "r1" }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("eventbridge DashboardPage", () => {
  it("summarises bus count and rule count", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("eb-dash-buses")).toHaveTextContent("2"));
    // One rule per bus (mock returns [r1] for each of the two buses) = 2.
    await waitFor(() => expect(screen.getByTestId("eb-dash-rules")).toHaveTextContent("2"));
  });

  it("lists the buses in the table", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("custom-bus")).toBeInTheDocument());
    expect(screen.getByText("default")).toBeInTheDocument();
  });

  it("shows the unsupported banner when the emulator lacks EventBridge", async () => {
    listBuses.mockRejectedValue({ kind: "internal", message: "UnknownOperationException" });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("eventbridge-unsupported")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("eb-dash-summary")).not.toBeInTheDocument();
  });

  it("shows the error banner on a generic listing failure", async () => {
    listBuses.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listBuses).not.toHaveBeenCalled();
  });
});
