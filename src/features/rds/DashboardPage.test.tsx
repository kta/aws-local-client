import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { DbInstanceSummary, DbSnapshot } from "../../api/rds";

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

const listInstances = vi.fn();
const listSnapshots = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    rds: {
      listInstances: (...args: unknown[]) => listInstances(...args),
      listSnapshots: (...args: unknown[]) => listSnapshots(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const instance = (id: string, status: string): DbInstanceSummary => ({
  id,
  engine: "mysql",
  status,
  instanceClass: "db.t3.micro",
  endpointAddress: null,
  endpointPort: null,
  allocatedStorage: 20,
});

const snapshot = (id: string): DbSnapshot => ({
  id,
  instanceId: "db-1",
  status: "available",
  createdAt: null,
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/rds"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("RDS DashboardPage (R47)", () => {
  beforeEach(() => {
    listInstances.mockReset();
    listSnapshots.mockReset();
  });

  it("shows instance/available/snapshot summary counts", async () => {
    listInstances.mockResolvedValue([instance("db-1", "available"), instance("db-2", "creating")]);
    listSnapshots.mockResolvedValue([snapshot("s-1"), snapshot("s-2"), snapshot("s-3")]);

    renderPage();

    await waitFor(() => expect(screen.getByTestId("rds-dash-instances")).toHaveTextContent("2"));
    expect(screen.getByTestId("rds-dash-available")).toHaveTextContent("1");
    expect(screen.getByTestId("rds-dash-snapshots")).toHaveTextContent("3");
  });

  it("renders the snapshot count as '-' when snapshots are unsupported", async () => {
    listInstances.mockResolvedValue([instance("db-1", "available")]);
    listSnapshots.mockRejectedValue(new Error("API not yet implemented"));

    renderPage();

    await waitFor(() => expect(screen.getByTestId("rds-dash-instances")).toHaveTextContent("1"));
    expect(screen.getByTestId("rds-dash-snapshots")).toHaveTextContent("-");
    // The dashboard still renders; no takeover banner.
    expect(screen.queryByTestId("rds-unsupported")).not.toBeInTheDocument();
  });

  it("shows the rds-unsupported banner when describe is unsupported", async () => {
    listInstances.mockRejectedValue(new Error("API for service 'rds' not yet implemented"));

    renderPage();

    expect(await screen.findByTestId("rds-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("rds-dash-create")).not.toBeInTheDocument();
  });
});
