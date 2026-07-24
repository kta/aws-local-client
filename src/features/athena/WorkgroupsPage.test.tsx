import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { WorkgroupSummary } from "../../api/athena";

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

const listWorkgroups = vi.fn();
const createWorkgroup = vi.fn();
const deleteWorkgroup = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    athena: {
      listWorkgroups: (...a: unknown[]) => listWorkgroups(...a),
      createWorkgroup: (...a: unknown[]) => createWorkgroup(...a),
      deleteWorkgroup: (...a: unknown[]) => deleteWorkgroup(...a),
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

import { ConnectionsProvider } from "../../state/connections";
import { WorkgroupsPage } from "./WorkgroupsPage";

const wg = (name: string): WorkgroupSummary => ({
  name,
  description: null,
  state: "ENABLED",
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConnectionsProvider>
        <WorkgroupsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  connState.active = profiles[0];
});

describe("Athena WorkgroupsPage (R90)", () => {
  it("lists workgroups with a count", async () => {
    listWorkgroups.mockResolvedValue([wg("primary"), wg("analytics")]);
    renderPage();

    await screen.findByTestId("workgroup-row-primary");
    expect(screen.getByTestId("workgroup-row-analytics")).toBeInTheDocument();
    expect(screen.getByTestId("workgroups-count").textContent).toContain("2");
  });

  it("creates a workgroup", async () => {
    listWorkgroups.mockResolvedValue([]);
    createWorkgroup.mockResolvedValueOnce(undefined);
    renderPage();

    await screen.findByTestId("workgroups-create");
    fireEvent.click(screen.getByTestId("workgroups-create"));
    fireEvent.change(screen.getByTestId("wg-name"), { target: { value: "analytics" } });
    fireEvent.change(screen.getByTestId("wg-desc"), { target: { value: "team" } });
    fireEvent.click(screen.getByTestId("wg-save"));

    await waitFor(() =>
      expect(createWorkgroup).toHaveBeenCalledWith(profiles[0], "analytics", "team"),
    );
  });

  it("deletes a workgroup after typing its name", async () => {
    listWorkgroups.mockResolvedValue([wg("analytics")]);
    deleteWorkgroup.mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(await screen.findByTestId("workgroup-delete-analytics"));
    fireEvent.change(screen.getByTestId("workgroups-delete-input"), {
      target: { value: "analytics" },
    });
    fireEvent.click(screen.getByTestId("workgroups-delete-confirm"));

    await waitFor(() => expect(deleteWorkgroup).toHaveBeenCalledWith(profiles[0], "analytics"));
  });

  it("shows the error banner when the list fails", async () => {
    listWorkgroups.mockRejectedValue({ kind: "connection", message: "cannot connect" });
    renderPage();

    const banner = await screen.findByTestId("error-banner");
    expect(banner.textContent).toContain("cannot connect");
  });

  it("shows the unsupported banner and hides create when unsupported", async () => {
    listWorkgroups.mockRejectedValue({ kind: "internal", message: "pro feature" });
    renderPage();

    expect(await screen.findByTestId("athena-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("workgroups-create")).toBeNull();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    connState.active = null;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
  });
});
