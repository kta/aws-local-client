import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, PartiqlResult } from "../../api/types";
import type { DdbItem } from "../../lib/ddbJson";

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

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ddb: {
      listTables: vi.fn(async () => ["Users", "Orders"]),
      executeStatement: vi.fn(),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { api } from "../../api/client";
import { ConnectionsProvider } from "../../state/connections";
import { PartiqlPage } from "./PartiqlPage";

const executeStatement = api.ddb.executeStatement as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectionsProvider>
        <PartiqlPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

const row = (id: string, name: string): DdbItem => ({ id: { S: id }, name: { S: name } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartiqlPage", () => {
  it("renders SELECT results as rows with plain-JSON values", async () => {
    executeStatement.mockResolvedValueOnce({ items: [row("1", "Alice"), row("2", "Bob")] } as PartiqlResult);
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("partiql-statement");
    fireEvent.change(textarea, { target: { value: 'SELECT * FROM "Users"' } });
    fireEvent.click(screen.getByTestId("partiql-run"));

    const table = await screen.findByTestId("partiql-results");
    const rows = within(table).getAllByTestId("partiql-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Alice")).toBeTruthy();
    expect(within(rows[1]).getByText("Bob")).toBeTruthy();
    expect(screen.getByTestId("partiql-count").textContent).toContain("2");
  });

  it("appends the next page via load-more using nextToken", async () => {
    executeStatement
      .mockResolvedValueOnce({ items: [row("1", "Alice")], nextToken: "tok-1" } as PartiqlResult)
      .mockResolvedValueOnce({ items: [row("2", "Bob")] } as PartiqlResult);
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("partiql-statement");
    fireEvent.change(textarea, { target: { value: 'SELECT * FROM "Users"' } });
    fireEvent.click(screen.getByTestId("partiql-run"));

    await screen.findByTestId("partiql-load-more");
    fireEvent.click(screen.getByTestId("partiql-load-more"));

    await waitFor(() =>
      expect(within(screen.getByTestId("partiql-results")).getAllByTestId("partiql-row")).toHaveLength(2),
    );
    expect(executeStatement).toHaveBeenLastCalledWith(profiles[0], 'SELECT * FROM "Users"', "tok-1");
    // No more pages -> load-more gone.
    expect(screen.queryByTestId("partiql-load-more")).toBeNull();
  });

  it("shows a success message for a non-SELECT statement with 0 items", async () => {
    executeStatement.mockResolvedValueOnce({ items: [] } as PartiqlResult);
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("partiql-statement");
    fireEvent.change(textarea, { target: { value: 'INSERT INTO "Users" VALUE {\'id\':\'9\'}' } });
    fireEvent.click(screen.getByTestId("partiql-run"));

    const success = await screen.findByTestId("partiql-success");
    expect(success.textContent).toContain("ステートメントを実行しました(結果 0 件)");
    expect(screen.queryByTestId("partiql-results")).toBeNull();
  });

  it("shows an error banner when the statement fails", async () => {
    executeStatement.mockRejectedValueOnce({ kind: "validation", message: "bad statement" });
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("partiql-statement");
    fireEvent.change(textarea, { target: { value: "SELECT nope" } });
    fireEvent.click(screen.getByTestId("partiql-run"));

    const banner = await screen.findByTestId("error-banner");
    expect(banner.textContent).toContain("bad statement");
  });

  it("fills the textarea from the template select", async () => {
    renderPage();

    const select = await screen.findByTestId<HTMLSelectElement>("partiql-template-select");
    await waitFor(() => expect(within(select).queryByText("Users")).toBeTruthy());
    fireEvent.change(select, { target: { value: "Users" } });

    const textarea = screen.getByTestId<HTMLTextAreaElement>("partiql-statement");
    expect(textarea.value).toBe('SELECT * FROM "Users"');
  });

  it("disables run while the statement is empty", async () => {
    renderPage();
    const runBtn = await screen.findByTestId<HTMLButtonElement>("partiql-run");
    expect(runBtn.disabled).toBe(true);
  });
});
