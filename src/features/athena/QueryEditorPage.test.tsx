import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { QueryResults } from "../../api/athena";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "ministack",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
  {
    id: "2",
    name: "floci",
    endpointUrl: "http://localhost:4567",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

const startQuery = vi.fn();
const getQueryExecution = vi.fn();
const getQueryResults = vi.fn();
const createNamedQuery = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    athena: {
      startQuery: (...a: unknown[]) => startQuery(...a),
      getQueryExecution: (...a: unknown[]) => getQueryExecution(...a),
      getQueryResults: (...a: unknown[]) => getQueryResults(...a),
      createNamedQuery: (...a: unknown[]) => createNamedQuery(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const connState = vi.hoisted(() => ({ active: null as ConnectionProfile | null }));
vi.mock("../../state/connections", () => ({
  ConnectionsProvider: ({ children }: { children: React.ReactNode }) => children,
  useConnections: () => ({
    profiles,
    active: connState.active,
    setActiveId: vi.fn(),
    refresh: vi.fn(),
    loading: false,
  }),
}));

import type { ReactNode } from "react";
import { ConnectionsProvider } from "../../state/connections";
import { QueryEditorPage } from "./QueryEditorPage";

const results = (columns: string[], rows: string[][]): QueryResults => ({ columns, rows });

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ConnectionsProvider>{children}</ConnectionsProvider>
    </MemoryRouter>
  );
}

function renderPage(initialPath = "/athena") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConnectionsProvider>
        <QueryEditorPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  connState.active = profiles[0];
});

describe("QueryEditorPage (R89)", () => {
  it("runs a statement and renders result rows", async () => {
    startQuery.mockResolvedValueOnce({ executionId: "q-1" });
    getQueryExecution.mockResolvedValueOnce({ state: "SUCCEEDED", reason: null });
    getQueryResults.mockResolvedValueOnce(results(["result"], [["mock_value"]]));
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("athena-run"));

    const table = await screen.findByTestId("athena-results");
    const rows = within(table).getAllByTestId("athena-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("mock_value")).toBeTruthy();
    expect(screen.getByTestId("athena-count").textContent).toContain("1");
    expect(startQuery).toHaveBeenCalledWith(profiles[0], "SELECT 1");
  });

  it("polls through a RUNNING state before rendering results", async () => {
    startQuery.mockResolvedValueOnce({ executionId: "q-2" });
    getQueryExecution
      .mockResolvedValueOnce({ state: "RUNNING", reason: null })
      .mockResolvedValueOnce({ state: "SUCCEEDED", reason: null });
    getQueryResults.mockResolvedValueOnce(results(["c"], [["v"]]));
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("athena-run"));

    // The running indicator is shown while polling.
    await screen.findByTestId("athena-running");
    await screen.findByTestId("athena-results");
    await waitFor(() => expect(getQueryExecution).toHaveBeenCalledTimes(2));
  });

  it("shows the error banner when the query fails", async () => {
    startQuery.mockResolvedValueOnce({ executionId: "q-3" });
    getQueryExecution.mockResolvedValueOnce({ state: "FAILED", reason: "boom" });
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT bad" } });
    fireEvent.click(screen.getByTestId("athena-run"));

    const banner = await screen.findByTestId("error-banner");
    expect(banner.textContent).toContain("boom");
    expect(screen.queryByTestId("athena-results")).toBeNull();
  });

  it("shows the unsupported banner when Athena is not implemented", async () => {
    startQuery.mockRejectedValueOnce({ kind: "internal", message: "pro feature" });
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("athena-run"));

    expect(await screen.findByTestId("athena-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("error-banner")).toBeNull();
  });

  it("shows a success message for a statement with 0 rows", async () => {
    startQuery.mockResolvedValueOnce({ executionId: "q-4" });
    getQueryExecution.mockResolvedValueOnce({ state: "SUCCEEDED", reason: null });
    getQueryResults.mockResolvedValueOnce(results(["c"], []));
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "CREATE TABLE t" } });
    fireEvent.click(screen.getByTestId("athena-run"));

    const success = await screen.findByTestId("athena-success");
    expect(success.textContent).toContain("結果 0 件");
    expect(screen.queryByTestId("athena-results")).toBeNull();
  });

  it("saves the statement as a named query", async () => {
    createNamedQuery.mockResolvedValueOnce({ namedQueryId: "nq-1" });
    renderPage();

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT 42" } });
    fireEvent.click(screen.getByTestId("athena-save"));

    fireEvent.change(screen.getByTestId("athena-save-name"), { target: { value: "daily" } });
    fireEvent.change(screen.getByTestId("athena-save-db"), { target: { value: "analytics" } });
    fireEvent.click(screen.getByTestId("athena-save-confirm"));

    await waitFor(() =>
      expect(createNamedQuery).toHaveBeenCalledWith(profiles[0], "daily", "SELECT 42", "analytics"),
    );
  });

  it("disables run while the statement is empty", async () => {
    renderPage();
    const runBtn = await screen.findByTestId<HTMLButtonElement>("athena-run");
    expect(runBtn.disabled).toBe(true);
  });

  it("loads a saved query into the editor from ?q=", async () => {
    renderPage(`/athena?q=${encodeURIComponent('SELECT * FROM "logs"')}`);
    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    await waitFor(() => expect(textarea.value).toBe('SELECT * FROM "logs"'));
  });

  it("clears prior results when the active connection changes", async () => {
    startQuery.mockResolvedValueOnce({ executionId: "q-5" });
    getQueryExecution.mockResolvedValueOnce({ state: "SUCCEEDED", reason: null });
    getQueryResults.mockResolvedValueOnce(results(["c"], [["v"]]));
    const { rerender } = render(<QueryEditorPage />, { wrapper: Wrapper });

    const textarea = await screen.findByTestId<HTMLTextAreaElement>("athena-statement");
    fireEvent.change(textarea, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByTestId("athena-run"));
    await screen.findByTestId("athena-results");

    connState.active = profiles[1];
    rerender(<QueryEditorPage />);

    await waitFor(() => expect(screen.queryByTestId("athena-results")).toBeNull());
    // Statement text (user input) is preserved.
    expect(screen.getByTestId<HTMLTextAreaElement>("athena-statement").value).toBe("SELECT 1");
  });
});
