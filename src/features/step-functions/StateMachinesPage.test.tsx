import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { StateMachineSummary } from "../../api/stepfunctions";
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

const sampleMachines: StateMachineSummary[] = [
  {
    stateMachineArn: "arn:aws:states:ap-northeast-1:000000000000:stateMachine:orders",
    name: "orders",
    type: "STANDARD",
    createdAt: "2026-07-22T00:00:00Z",
  },
  {
    stateMachineArn: "arn:aws:states:ap-northeast-1:000000000000:stateMachine:reports",
    name: "reports",
    type: "STANDARD",
    createdAt: "2026-07-22T01:00:00Z",
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    stepfunctions: {
      listStateMachines: (...args: unknown[]) => listStateMachines(...args),
      createStateMachine: (...args: unknown[]) => createStateMachine(...args),
      deleteStateMachine: (...args: unknown[]) => deleteStateMachine(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listStateMachines = vi.fn();
const createStateMachine = vi.fn();
const deleteStateMachine = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { StateMachinesPage } from "./StateMachinesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/step-functions/state-machines"]}>
      <ConnectionsProvider>
        <StateMachinesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listStateMachines.mockReset().mockResolvedValue(sampleMachines);
  createStateMachine.mockReset().mockResolvedValue(undefined);
  deleteStateMachine.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StateMachinesPage", () => {
  it("renders state machine rows", async () => {
    renderPage();
    expect(await screen.findByTestId("sm-link-orders")).toBeInTheDocument();
    expect(screen.getByTestId("sm-link-reports")).toBeInTheDocument();
  });

  it("creates a state machine and reloads the list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("state-machines-create"));
    fireEvent.change(await screen.findByTestId("sm-name"), { target: { value: "new-sm" } });
    fireEvent.click(screen.getByTestId("sm-save"));

    await waitFor(() =>
      expect(createStateMachine).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-sm",
        expect.stringContaining("StartAt"),
      ),
    );
    await waitFor(() => expect(listStateMachines).toHaveBeenCalledTimes(2));
  });

  it("blocks create when the definition is invalid JSON", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("state-machines-create"));
    fireEvent.change(await screen.findByTestId("sm-name"), { target: { value: "bad" } });
    fireEvent.change(screen.getByTestId("sm-definition"), { target: { value: "{ not json" } });
    expect(await screen.findByTestId("sm-definition-error")).toBeInTheDocument();
    expect(screen.getByTestId("sm-save")).toBeDisabled();
  });

  it("deletes a state machine after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("orders を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("state-machines-delete"));

    const confirm = screen.getByTestId("state-machines-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("state-machines-delete-input"), {
      target: { value: "orders" },
    });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteStateMachine).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        sampleMachines[0].stateMachineArn,
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listStateMachines.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listStateMachines).not.toHaveBeenCalled();
  });
});
