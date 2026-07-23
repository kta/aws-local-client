import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { UserPoolSummary } from "../../api/cognito";
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

const samplePools: UserPoolSummary[] = [
  { id: "ap-northeast-1_aaa", name: "pool-a", createdAt: null },
  { id: "ap-northeast-1_bbb", name: "pool-b", createdAt: null },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    cognito: {
      listUserPools: (...args: unknown[]) => listUserPools(...args),
      createUserPool: (...args: unknown[]) => createUserPool(...args),
      deleteUserPool: (...args: unknown[]) => deleteUserPool(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listUserPools = vi.fn();
const createUserPool = vi.fn();
const deleteUserPool = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { UserPoolsPage } from "./UserPoolsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cognito/user-pools"]}>
      <ConnectionsProvider>
        <UserPoolsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listUserPools.mockReset().mockResolvedValue(samplePools);
  createUserPool.mockReset().mockResolvedValue(undefined);
  deleteUserPool.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UserPoolsPage (R60)", () => {
  it("renders pool rows with name and id links", async () => {
    renderPage();
    expect(await screen.findByTestId("pool-link-pool-a")).toBeInTheDocument();
    expect(screen.getByTestId("pool-link-pool-b")).toBeInTheDocument();
    expect(screen.getByTestId("pool-row-pool-a")).toHaveTextContent("ap-northeast-1_aaa");
  });

  it("creates a pool and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("pools-create");

    fireEvent.click(screen.getByTestId("pools-create"));
    fireEvent.change(await screen.findByTestId("cp-name"), { target: { value: "new-pool" } });
    fireEvent.click(screen.getByTestId("cp-save"));

    await waitFor(() =>
      expect(createUserPool).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-pool",
      ),
    );
    await waitFor(() => expect(listUserPools).toHaveBeenCalledTimes(2));
  });

  it("deletes a pool after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("pool-a を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("pools-delete"));

    const confirm = screen.getByTestId("pools-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("pools-delete-input"), { target: { value: "pool-a" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteUserPool).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_aaa",
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listUserPools.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the cognito-unsupported banner and hides create when unsupported", async () => {
    listUserPools.mockRejectedValue({
      kind: "internal",
      message: "API for service 'cognito-idp' not yet implemented or pro feature",
    });
    renderPage();
    expect(await screen.findByTestId("cognito-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("pools-create")).not.toBeInTheDocument();
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listUserPools).not.toHaveBeenCalled();
  });
});
