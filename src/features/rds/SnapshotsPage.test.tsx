import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const listSnapshots = vi.fn();
const listInstances = vi.fn();
const createSnapshot = vi.fn();
const restoreSnapshot = vi.fn();
const deleteSnapshot = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    rds: {
      listSnapshots: (...args: unknown[]) => listSnapshots(...args),
      listInstances: (...args: unknown[]) => listInstances(...args),
      createSnapshot: (...args: unknown[]) => createSnapshot(...args),
      restoreSnapshot: (...args: unknown[]) => restoreSnapshot(...args),
      deleteSnapshot: (...args: unknown[]) => deleteSnapshot(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const snapshot = (id: string): DbSnapshot => ({
  id,
  instanceId: "db-1",
  status: "available",
  createdAt: "2026-07-14T00:00:00Z",
});

const instanceSummary = (id: string): DbInstanceSummary => ({
  id,
  engine: "mysql",
  status: "available",
  instanceClass: "db.t3.micro",
  endpointAddress: null,
  endpointPort: null,
  allocatedStorage: 20,
});

import { ConnectionsProvider } from "../../state/connections";
import { SnapshotsPage } from "./SnapshotsPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/rds/snapshots"]}>
      <ConnectionsProvider>
        <SnapshotsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("SnapshotsPage (R49)", () => {
  beforeEach(() => {
    listSnapshots.mockReset().mockResolvedValue([snapshot("snap-1")]);
    listInstances.mockReset().mockResolvedValue([instanceSummary("db-1")]);
    createSnapshot.mockReset().mockResolvedValue(undefined);
    restoreSnapshot.mockReset().mockResolvedValue(undefined);
    deleteSnapshot.mockReset().mockResolvedValue(undefined);
  });

  it("lists snapshots", async () => {
    renderPage();
    expect(await screen.findByTestId("snapshot-row-snap-1")).toBeInTheDocument();
    expect(screen.getByTestId("snapshots-table")).toBeInTheDocument();
  });

  it("creates a snapshot via the modal", async () => {
    renderPage();
    await screen.findByTestId("snapshot-row-snap-1");

    fireEvent.click(screen.getByTestId("snapshots-create"));
    await waitFor(() => expect(screen.getByTestId("snap-instance-select")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("snap-id-input"), { target: { value: "new-snap" } });
    fireEvent.click(screen.getByTestId("snap-save"));

    await waitFor(() => expect(createSnapshot).toHaveBeenCalledWith(profiles[0], "db-1", "new-snap"));
  });

  it("restores a snapshot to a new instance", async () => {
    renderPage();
    await screen.findByTestId("snapshot-row-snap-1");

    fireEvent.click(screen.getByTestId("snapshot-restore"));
    fireEvent.change(screen.getByTestId("restore-id-input"), { target: { value: "db-restored" } });
    fireEvent.click(screen.getByTestId("restore-save"));

    await waitFor(() =>
      expect(restoreSnapshot).toHaveBeenCalledWith(profiles[0], "snap-1", "db-restored"),
    );
  });

  it("deletes a snapshot after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByTestId("snapshot-row-snap-1");

    fireEvent.click(screen.getByTestId("snapshots-delete"));
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith(profiles[0], "snap-1"));
  });

  it("shows the snapshots-unsupported banner when describe is unsupported", async () => {
    listSnapshots.mockReset().mockRejectedValue(new Error("API not yet implemented"));
    renderPage();
    expect(await screen.findByTestId("snapshots-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("snapshots-create")).not.toBeInTheDocument();
  });
});
