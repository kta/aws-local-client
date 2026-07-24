import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { HostedZoneSummary } from "../../api/route53";
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

const zones: HostedZoneSummary[] = [
  { id: "/hostedzone/Z1", name: "example.com.", recordCount: 4, privateZone: false },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    route53: {
      listHostedZones: (...a: unknown[]) => listHostedZones(...a),
      listHealthChecks: (...a: unknown[]) => listHealthChecks(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listHostedZones = vi.fn();
const listHealthChecks = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/route53"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listHostedZones.mockReset().mockResolvedValue(zones);
  listHealthChecks.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("route53 DashboardPage", () => {
  it("summarises zone and health check counts", async () => {
    listHealthChecks.mockResolvedValue([{ id: "hc-1" }]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("route53-dash-zones")).toHaveTextContent("1"));
    expect(screen.getByTestId("route53-dash-healthchecks")).toHaveTextContent("1");
  });

  it("shows '-' for the health check count when the emulator does not support it", async () => {
    listHealthChecks.mockRejectedValue({ kind: "internal", message: "404 page not found" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("route53-dash-zones")).toHaveTextContent("1"));
    expect(screen.getByTestId("route53-dash-healthchecks")).toHaveTextContent("-");
  });
});
