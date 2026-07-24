import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  ExecutionSummary,
  StateMachineDetail,
  StateMachineSummary,
} from "../../api/stepfunctions";
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

const ARN = "arn:aws:states:ap-northeast-1:000000000000:stateMachine:orders";

const summary: StateMachineSummary = {
  stateMachineArn: ARN,
  name: "orders",
  type: "STANDARD",
  createdAt: "2026-07-22T00:00:00Z",
};

const detail: StateMachineDetail = {
  stateMachineArn: ARN,
  name: "orders",
  status: "ACTIVE",
  definition: '{"StartAt":"P","States":{"P":{"Type":"Pass","End":true}}}',
  roleArn: "arn:aws:iam::000000000000:role/nlsd-dummy",
  type: "STANDARD",
  createdAt: "2026-07-22T00:00:00Z",
};

const executions: ExecutionSummary[] = [
  {
    executionArn: `${ARN.replace("stateMachine", "execution")}:e1`,
    name: "e1",
    status: "SUCCEEDED",
    startedAt: "2026-07-22T00:00:00Z",
    stoppedAt: "2026-07-22T00:00:01Z",
  },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    stepfunctions: {
      listStateMachines: (...a: unknown[]) => listStateMachines(...a),
      describeStateMachine: (...a: unknown[]) => describeStateMachine(...a),
      listExecutions: (...a: unknown[]) => listExecutions(...a),
      startExecution: (...a: unknown[]) => startExecution(...a),
      updateStateMachine: (...a: unknown[]) => updateStateMachine(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listStateMachines = vi.fn();
const describeStateMachine = vi.fn();
const listExecutions = vi.fn();
const startExecution = vi.fn();
const updateStateMachine = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { StateMachineDetailPage } from "./StateMachineDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/step-functions/state-machines/orders"]}>
      <ConnectionsProvider>
        <Routes>
          <Route
            path="/step-functions/state-machines/:name"
            element={<StateMachineDetailPage />}
          />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listStateMachines.mockReset().mockResolvedValue([summary]);
  describeStateMachine.mockReset().mockResolvedValue(detail);
  listExecutions.mockReset().mockResolvedValue(executions);
  startExecution.mockReset().mockResolvedValue({ executionArn: "arn:exec:new" });
  updateStateMachine.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StateMachineDetailPage", () => {
  it("lists executions and starts a new one", async () => {
    renderPage();
    expect(await screen.findByTestId("exec-link-e1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sm-start"));
    fireEvent.change(await screen.findByTestId("exec-input"), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByTestId("exec-save"));

    await waitFor(() =>
      expect(startExecution).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        ARN,
        '{"a":1}',
      ),
    );
  });

  it("displays and updates the definition (supported)", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-definition"));
    expect(await screen.findByTestId("definition-display")).toHaveTextContent("Pass");

    fireEvent.click(screen.getByTestId("definition-save"));
    await waitFor(() => expect(updateStateMachine).toHaveBeenCalled());
  });

  it("shows the unsupported notice when update is not implemented", async () => {
    updateStateMachine.mockRejectedValue({
      kind: "internal",
      message: "Operation UpdateStateMachine is not supported.",
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-definition"));
    fireEvent.click(await screen.findByTestId("definition-save"));
    await waitFor(() =>
      expect(screen.getByTestId("sfn-update-unsupported")).toBeInTheDocument(),
    );
  });
});
