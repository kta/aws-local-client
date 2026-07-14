import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";

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
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

import { ConnectionsProvider } from "../../state/connections";
import { TablesPage } from "./TablesPage";

describe("TablesPage ?create=1", () => {
  beforeEach(() => {
    listTables.mockReset().mockResolvedValue([]);
    describeTable.mockReset();
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
