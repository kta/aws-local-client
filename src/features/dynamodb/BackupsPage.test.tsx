import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { BackupSummary, ConnectionProfile } from "../../api/types";

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

const sampleBackups: BackupSummary[] = [
  {
    backupArn: "arn:aws:dynamodb:local:000000000000:table/orders/backup/01",
    backupName: "orders-daily",
    tableName: "orders",
    status: "AVAILABLE",
    sizeBytes: 2048,
    createdAt: "2026-07-14T10:00:00Z",
  },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ddb: {
      listTables: vi.fn(async () => ["orders", "users"]),
      listBackups: vi.fn(async () => sampleBackups),
      createBackup: vi.fn(async () => undefined),
      deleteBackup: vi.fn(async () => undefined),
      restoreBackup: vi.fn(async () => undefined),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { api } from "../../api/client";
import { ConnectionsProvider } from "../../state/connections";
import { BackupsPage } from "./BackupsPage";

const ddb = api.ddb as unknown as {
  listTables: ReturnType<typeof vi.fn>;
  listBackups: ReturnType<typeof vi.fn>;
  createBackup: ReturnType<typeof vi.fn>;
  deleteBackup: ReturnType<typeof vi.fn>;
  restoreBackup: ReturnType<typeof vi.fn>;
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectionsProvider>
        <BackupsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  ddb.listTables.mockResolvedValue(["orders", "users"]);
  ddb.listBackups.mockResolvedValue(sampleBackups);
  ddb.createBackup.mockResolvedValue(undefined);
  ddb.deleteBackup.mockResolvedValue(undefined);
  ddb.restoreBackup.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("BackupsPage", () => {
  it("renders backup rows from listBackups", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("backup-row")).toHaveLength(1));
    expect(screen.getByText("orders-daily")).toBeInTheDocument();
    expect(screen.getByText("AVAILABLE")).toBeInTheDocument();
  });

  it("shows the empty message when there are no backups", async () => {
    ddb.listBackups.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("backups-empty")).toBeInTheDocument());
  });

  it("creates a backup with the chosen table and name, then refreshes", async () => {
    renderPage();
    await screen.findByTestId("backups-create");

    fireEvent.click(screen.getByTestId("backups-create"));
    await screen.findByTestId("backup-create-table");

    fireEvent.change(screen.getByTestId("backup-create-table"), { target: { value: "users" } });
    fireEvent.change(screen.getByTestId("backup-create-name"), { target: { value: "users-bk" } });
    fireEvent.click(screen.getByTestId("backup-create-submit"));

    await waitFor(() =>
      expect(ddb.createBackup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "users",
        "users-bk",
      ),
    );
    // list reloaded (initial load + refresh)
    await waitFor(() => expect(ddb.listBackups).toHaveBeenCalledTimes(2));
  });

  it("restores a backup with the target table name", async () => {
    renderPage();
    await screen.findByTestId("backup-restore");

    fireEvent.click(screen.getByTestId("backup-restore"));
    await screen.findByTestId("backup-restore-target");

    fireEvent.change(screen.getByTestId("backup-restore-target"), {
      target: { value: "orders-copy" },
    });
    fireEvent.click(screen.getByTestId("backup-restore-submit"));

    await waitFor(() =>
      expect(ddb.restoreBackup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        sampleBackups[0].backupArn,
        "orders-copy",
      ),
    );
    await screen.findByTestId("backups-note");
  });

  it("deletes a backup after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByTestId("backup-delete");

    fireEvent.click(screen.getByTestId("backup-delete"));

    await waitFor(() =>
      expect(ddb.deleteBackup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        sampleBackups[0].backupArn,
      ),
    );
    confirmSpy.mockRestore();
  });

  it("does not delete when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByTestId("backup-delete");

    fireEvent.click(screen.getByTestId("backup-delete"));
    expect(ddb.deleteBackup).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows the unsupported banner and hides create when the emulator lacks the API", async () => {
    ddb.listBackups.mockRejectedValue({
      kind: "internal",
      message: "UnknownOperationException: unknown operation",
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("backups-unsupported")).toBeInTheDocument());
    expect(screen.queryByTestId("backups-create")).not.toBeInTheDocument();
    expect(screen.getByText(/unknown operation/i)).toBeInTheDocument();
  });

  it("shows the normal error banner for other errors", async () => {
    ddb.listBackups.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("backups-unsupported")).not.toBeInTheDocument();
  });
});
