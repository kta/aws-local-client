import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { LogGroup } from "../../api/cloudwatch";
import type { ConnectionProfile } from "../../api/types";

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

const sampleGroups: LogGroup[] = [
  { name: "/nlsd/app", retentionInDays: 7, storedBytes: 2048, createdAt: null },
  { name: "/nlsd/web", retentionInDays: null, storedBytes: 0, createdAt: null },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    cloudwatch: {
      listLogGroups: (...args: unknown[]) => listLogGroups(...args),
      createLogGroup: (...args: unknown[]) => createLogGroup(...args),
      deleteLogGroup: (...args: unknown[]) => deleteLogGroup(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listLogGroups = vi.fn();
const createLogGroup = vi.fn();
const deleteLogGroup = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { LogGroupsPage } from "./LogGroupsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudwatch/log-groups"]}>
      <ConnectionsProvider>
        <LogGroupsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listLogGroups.mockReset().mockResolvedValue(sampleGroups);
  createLogGroup.mockReset().mockResolvedValue(undefined);
  deleteLogGroup.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LogGroupsPage", () => {
  it("renders log-group rows with retention and size", async () => {
    renderPage();
    expect(await screen.findByTestId("lg-link-/nlsd/app")).toBeInTheDocument();
    expect(screen.getByTestId("lg-link-/nlsd/web")).toBeInTheDocument();
    expect(screen.getByText("7 日")).toBeInTheDocument();
    expect(screen.getByText("無期限")).toBeInTheDocument();
  });

  it("creates a log group and reloads the list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("lg-create"));
    fireEvent.change(await screen.findByTestId("lg-name"), { target: { value: "/nlsd/new" } });
    fireEvent.click(screen.getByTestId("lg-save"));
    await waitFor(() =>
      expect(createLogGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/nlsd/new",
      ),
    );
    await waitFor(() => expect(listLogGroups).toHaveBeenCalledTimes(2));
  });

  it("deletes a log group after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("/nlsd/app を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("lg-delete"));
    const confirm = screen.getByTestId("lg-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("lg-delete-input"), { target: { value: "/nlsd/app" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteLogGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/nlsd/app",
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listLogGroups.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listLogGroups).not.toHaveBeenCalled();
  });
});
