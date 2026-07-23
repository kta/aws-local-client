import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { CfnStackSummary } from "../../api/cloudformation";
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

const sampleStacks: CfnStackSummary[] = [
  { name: "app-stack", status: "CREATE_COMPLETE", statusReason: null, createdAt: null },
  { name: "net-stack", status: "UPDATE_COMPLETE", statusReason: null, createdAt: null },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    cloudformation: {
      listStacks: (...args: unknown[]) => listStacks(...args),
      createStack: (...args: unknown[]) => createStack(...args),
      deleteStack: (...args: unknown[]) => deleteStack(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listStacks = vi.fn();
const createStack = vi.fn();
const deleteStack = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { StacksPage } from "./StacksPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudformation/stacks"]}>
      <ConnectionsProvider>
        <StacksPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listStacks.mockReset().mockResolvedValue(sampleStacks);
  createStack.mockReset().mockResolvedValue(undefined);
  deleteStack.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StacksPage", () => {
  it("renders stack rows with name and status", async () => {
    renderPage();
    expect(await screen.findByTestId("stack-row-app-stack")).toBeInTheDocument();
    expect(screen.getByTestId("stack-row-net-stack")).toBeInTheDocument();
    expect(screen.getByText("CREATE_COMPLETE")).toBeInTheDocument();
  });

  it("creates a stack with a template and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("stacks-create");
    fireEvent.click(screen.getByTestId("stacks-create"));
    fireEvent.change(await screen.findByTestId("cfn-name"), { target: { value: "new-stack" } });
    fireEvent.change(screen.getByTestId("cfn-template"), {
      target: { value: '{"Resources":{}}' },
    });
    fireEvent.click(screen.getByTestId("cfn-save"));

    await waitFor(() =>
      expect(createStack).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-stack",
        '{"Resources":{}}',
        [],
      ),
    );
    await waitFor(() => expect(listStacks).toHaveBeenCalledTimes(2));
  });

  it("adds a parameter row and sends it on create", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("stacks-create"));
    fireEvent.change(await screen.findByTestId("cfn-name"), { target: { value: "p-stack" } });
    fireEvent.click(screen.getByTestId("cfn-param-add"));
    fireEvent.change(screen.getByTestId("cfn-param-key-0"), { target: { value: "Env" } });
    fireEvent.change(screen.getByTestId("cfn-param-value-0"), { target: { value: "prod" } });
    fireEvent.click(screen.getByTestId("cfn-save"));

    await waitFor(() =>
      expect(createStack).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "p-stack",
        expect.any(String),
        [{ key: "Env", value: "prod" }],
      ),
    );
  });

  it("deletes a stack after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("app-stack を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("stacks-delete"));

    const confirm = screen.getByTestId("stacks-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("stacks-delete-input"), { target: { value: "app-stack" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteStack).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "app-stack"),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listStacks.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listStacks).not.toHaveBeenCalled();
  });
});
