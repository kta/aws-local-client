import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const deleteTable = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ddb: {
      listTables: (...args: unknown[]) => listTables(...args),
      describeTable: (...args: unknown[]) => describeTable(...args),
      deleteTable: (...args: unknown[]) => deleteTable(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const tableDetail = (name: string): TableDetail => ({
  name,
  status: "ACTIVE",
  itemCount: 0,
  sizeBytes: 0,
  keys: [{ name: "id", keyType: "HASH", attrType: "S" }],
  gsis: [],
  lsis: [],
});

import { ConnectionsProvider } from "../../state/connections";
import { TablesPage } from "./TablesPage";

describe("TablesPage ?create=1", () => {
  beforeEach(() => {
    listTables.mockReset().mockResolvedValue([]);
    describeTable.mockReset();
    deleteTable.mockReset().mockResolvedValue(undefined);
  });

  it("opens the create-table modal automatically", async () => {
    render(
      <MemoryRouter initialEntries={["/dynamodb/tables?create=1"]}>
        <ConnectionsProvider>
          <TablesPage />
        </ConnectionsProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("ct-name")).toBeInTheDocument();
  });

  it("does not open the modal without the create flag", async () => {
    render(
      <MemoryRouter initialEntries={["/dynamodb/tables"]}>
        <ConnectionsProvider>
          <TablesPage />
        </ConnectionsProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listTables).toHaveBeenCalled());
    expect(screen.queryByTestId("ct-name")).not.toBeInTheDocument();
  });
});

describe("TablesPage delete-from-list", () => {
  beforeEach(() => {
    listTables.mockReset().mockResolvedValue(["t1"]);
    describeTable.mockReset().mockResolvedValue(tableDetail("t1"));
    deleteTable.mockReset().mockResolvedValue(undefined);
  });

  it("confirms via the name-typed modal instead of window.prompt", async () => {
    render(
      <MemoryRouter initialEntries={["/dynamodb/tables"]}>
        <ConnectionsProvider>
          <TablesPage />
        </ConnectionsProvider>
      </MemoryRouter>,
    );

    // Selecting the single row enables the delete button, which opens the modal.
    const checkbox = await screen.findByLabelText("t1 を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("tables-delete"));

    // Confirm stays disabled until the exact table name is typed (no prompt).
    const confirm = screen.getByTestId("tables-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("tables-delete-input"), { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("tables-delete-input"), { target: { value: "t1" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(deleteTable).toHaveBeenCalledWith(profiles[0], "t1"));
  });
});
