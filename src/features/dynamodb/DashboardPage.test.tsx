import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile, TableDetail } from "../../api/types";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "localstack",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

const listTables = vi.fn();
const describeTable = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ddb: {
      listTables: (...args: unknown[]) => listTables(...args),
      describeTable: (...args: unknown[]) => describeTable(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function detail(over: Partial<TableDetail>): TableDetail {
  return {
    name: "t",
    status: "ACTIVE",
    itemCount: 0,
    sizeBytes: 0,
    keys: [],
    gsis: [],
    lsis: [],
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    listTables.mockReset();
    describeTable.mockReset();
  });

  it("renders summary counts from mocked listTables/describeTable", async () => {
    listTables.mockResolvedValue(["users", "orders"]);
    describeTable.mockImplementation(async (_p: unknown, name: string) =>
      name === "users"
        ? detail({ name: "users", itemCount: 3, sizeBytes: 500 })
        : detail({ name: "orders", itemCount: 10, sizeBytes: 2048 }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getAllByTestId("dashboard-table-row")).toHaveLength(2),
    );

    const summary = screen.getByTestId("dashboard-summary");
    expect(within(summary).getByText("2")).toBeInTheDocument(); // table count
    expect(within(summary).getByText("13")).toBeInTheDocument(); // total items
    expect(within(summary).getByText("2.5 KB")).toBeInTheDocument(); // total bytes
  });

  it("shows an empty state when there are zero tables", async () => {
    listTables.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByTestId("dashboard-empty")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-empty-create")).toBeInTheDocument();
    expect(describeTable).not.toHaveBeenCalled();
  });

  it("shows an error banner and refetches on retry", async () => {
    listTables.mockRejectedValueOnce({ kind: "connection", message: "boom" });

    renderPage();

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();

    listTables.mockResolvedValueOnce(["users"]);
    describeTable.mockResolvedValueOnce(detail({ name: "users", itemCount: 1, sizeBytes: 10 }));

    fireEvent.click(screen.getByTestId("error-retry"));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-table-row")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});
