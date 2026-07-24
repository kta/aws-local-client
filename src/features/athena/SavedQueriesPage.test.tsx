import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { NamedQuerySummary } from "../../api/athena";

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

const listNamedQueries = vi.fn();
const deleteNamedQuery = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    athena: {
      listNamedQueries: (...a: unknown[]) => listNamedQueries(...a),
      deleteNamedQuery: (...a: unknown[]) => deleteNamedQuery(...a),
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { ConnectionsProvider } from "../../state/connections";
import { SavedQueriesPage } from "./SavedQueriesPage";

const nq = (id: string, name: string, query: string): NamedQuerySummary => ({
  id,
  name,
  database: "default",
  description: null,
  queryString: query,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConnectionsProvider>
        <SavedQueriesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  connState.active = profiles[0];
});

describe("Athena SavedQueriesPage (R91)", () => {
  it("lists saved queries with a count", async () => {
    listNamedQueries.mockResolvedValue([nq("1", "daily", "SELECT 1"), nq("2", "weekly", "SELECT 2")]);
    renderPage();

    await screen.findByTestId("saved-query-row-daily");
    expect(screen.getByTestId("saved-query-row-weekly")).toBeInTheDocument();
    expect(screen.getByTestId("saved-queries-count").textContent).toContain("2");
  });

  it("inserts a saved query into the editor via navigation", async () => {
    listNamedQueries.mockResolvedValue([nq("1", "daily", 'SELECT * FROM "logs"')]);
    renderPage();

    fireEvent.click(await screen.findByTestId("saved-query-insert-daily"));
    expect(navigateMock).toHaveBeenCalledWith(
      `/athena?q=${encodeURIComponent('SELECT * FROM "logs"')}`,
    );
  });

  it("deletes a saved query after typing its name", async () => {
    listNamedQueries.mockResolvedValue([nq("1", "daily", "SELECT 1")]);
    deleteNamedQuery.mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(await screen.findByTestId("saved-query-delete-daily"));
    fireEvent.change(screen.getByTestId("saved-queries-delete-input"), {
      target: { value: "daily" },
    });
    fireEvent.click(screen.getByTestId("saved-queries-delete-confirm"));

    await waitFor(() => expect(deleteNamedQuery).toHaveBeenCalledWith(profiles[0], "1"));
  });

  it("shows the error banner when the list fails", async () => {
    listNamedQueries.mockRejectedValue({ kind: "connection", message: "cannot connect" });
    renderPage();

    const banner = await screen.findByTestId("error-banner");
    expect(banner.textContent).toContain("cannot connect");
  });

  it("shows the unsupported banner when named queries are unsupported", async () => {
    listNamedQueries.mockRejectedValue({ kind: "internal", message: "not supported" });
    renderPage();

    expect(await screen.findByTestId("athena-unsupported")).toBeInTheDocument();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    connState.active = null;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
  });
});
