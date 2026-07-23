import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { CognitoGroup, CognitoUser, UserPoolClientSummary } from "../../api/cognito";
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

const getUserPool = vi.fn();
const listUsers = vi.fn();
const adminCreateUser = vi.fn();
const adminDeleteUser = vi.fn();
const adminDisableUser = vi.fn();
const adminEnableUser = vi.fn();
const listUserPoolClients = vi.fn();
const createUserPoolClient = vi.fn();
const listGroups = vi.fn();
const createGroup = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cognito: {
      getUserPool: (...a: unknown[]) => getUserPool(...a),
      listUsers: (...a: unknown[]) => listUsers(...a),
      adminCreateUser: (...a: unknown[]) => adminCreateUser(...a),
      adminDeleteUser: (...a: unknown[]) => adminDeleteUser(...a),
      adminDisableUser: (...a: unknown[]) => adminDisableUser(...a),
      adminEnableUser: (...a: unknown[]) => adminEnableUser(...a),
      adminSetUserPassword: vi.fn(async () => undefined),
      listUserPoolClients: (...a: unknown[]) => listUserPoolClients(...a),
      createUserPoolClient: (...a: unknown[]) => createUserPoolClient(...a),
      deleteUserPoolClient: vi.fn(async () => undefined),
      listGroups: (...a: unknown[]) => listGroups(...a),
      createGroup: (...a: unknown[]) => createGroup(...a),
      deleteGroup: vi.fn(async () => undefined),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const user = (username: string, enabled = true): CognitoUser => ({
  username,
  status: "CONFIRMED",
  enabled,
  email: `${username}@example.com`,
  createdAt: null,
});
const client = (name: string): UserPoolClientSummary => ({ clientId: `cid-${name}`, clientName: name });
const group = (name: string): CognitoGroup => ({ name, description: "grp" });

import { ConnectionsProvider } from "../../state/connections";
import { UserPoolDetailPage } from "./UserPoolDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cognito/user-pools/ap-northeast-1_p1"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/cognito/user-pools/:id" element={<UserPoolDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getUserPool.mockReset().mockResolvedValue({
    id: "ap-northeast-1_p1",
    name: "pool-a",
    estimatedUsers: 1,
    createdAt: null,
  });
  listUsers.mockReset().mockResolvedValue([user("alice")]);
  adminCreateUser.mockReset().mockResolvedValue(undefined);
  adminDeleteUser.mockReset().mockResolvedValue(undefined);
  adminDisableUser.mockReset().mockResolvedValue(undefined);
  adminEnableUser.mockReset().mockResolvedValue(undefined);
  listUserPoolClients.mockReset().mockResolvedValue([client("web")]);
  createUserPoolClient.mockReset().mockResolvedValue(undefined);
  listGroups.mockReset().mockResolvedValue([group("admins")]);
  createGroup.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UserPoolDetailPage (R61/R62)", () => {
  it("R61: lists users and creates a new one", async () => {
    renderPage();
    expect(await screen.findByTestId("user-row-alice")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("user-create"));
    fireEvent.change(await screen.findByTestId("cu-username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByTestId("cu-email"), { target: { value: "bob@example.com" } });
    fireEvent.click(screen.getByTestId("cu-save"));

    await waitFor(() =>
      expect(adminCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_p1",
        "bob",
        "bob@example.com",
        undefined,
      ),
    );
  });

  it("R61: deletes a user after typing the username", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("user-delete-alice"));
    const confirm = screen.getByTestId("user-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("user-delete-input"), { target: { value: "alice" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(adminDeleteUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_p1",
        "alice",
      ),
    );
  });

  it("R61: disables an enabled user", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("user-disable-alice"));
    await waitFor(() =>
      expect(adminDisableUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_p1",
        "alice",
      ),
    );
  });

  it("R62: app clients tab lists and creates a client", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-app-clients"));
    expect(await screen.findByTestId("client-row-web")).toBeInTheDocument();
    expect(screen.getByTestId("client-id-web")).toHaveTextContent("cid-web");

    fireEvent.click(screen.getByTestId("client-create"));
    fireEvent.change(await screen.findByTestId("cc-name"), { target: { value: "mobile" } });
    fireEvent.click(screen.getByTestId("cc-save"));
    await waitFor(() =>
      expect(createUserPoolClient).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_p1",
        "mobile",
      ),
    );
  });

  it("R62: groups tab lists and creates a group", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-groups"));
    expect(await screen.findByTestId("group-row-admins")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("group-create"));
    fireEvent.change(await screen.findByTestId("cg-name"), { target: { value: "editors" } });
    fireEvent.change(screen.getByTestId("cg-desc"), { target: { value: "editor group" } });
    fireEvent.click(screen.getByTestId("cg-save"));
    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "ap-northeast-1_p1",
        "editors",
        "editor group",
      ),
    );
  });

  it("R62: groups tab shows the unsupported notice when groups are unsupported", async () => {
    listGroups.mockRejectedValue({
      kind: "internal",
      message: "The action ListGroups is not valid for this endpoint.",
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-groups"));
    expect(await screen.findByTestId("cognito-groups-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("group-create")).not.toBeInTheDocument();
  });
});
