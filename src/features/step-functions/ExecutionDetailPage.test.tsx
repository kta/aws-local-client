import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ExecutionDetail, HistoryEvent } from "../../api/stepfunctions";
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

const EXEC_ARN = "arn:aws:states:ap-northeast-1:000000000000:execution:orders:e1";

const detail: ExecutionDetail = {
  executionArn: EXEC_ARN,
  stateMachineArn: "arn:aws:states:ap-northeast-1:000000000000:stateMachine:orders",
  name: "e1",
  status: "SUCCEEDED",
  input: '{"hello":"world"}',
  output: '{"hello":"world"}',
  startedAt: "2026-07-22T00:00:00Z",
  stoppedAt: "2026-07-22T00:00:01Z",
};

const history: HistoryEvent[] = [
  { id: 1, eventType: "ExecutionStarted", timestamp: "2026-07-22T00:00:00Z" },
  { id: 4, eventType: "ExecutionSucceeded", timestamp: "2026-07-22T00:00:01Z" },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    stepfunctions: {
      describeExecution: (...a: unknown[]) => describeExecution(...a),
      getExecutionHistory: (...a: unknown[]) => getExecutionHistory(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const describeExecution = vi.fn();
const getExecutionHistory = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { ExecutionDetailPage } from "./ExecutionDetailPage";

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[`/step-functions/executions/${encodeURIComponent(EXEC_ARN)}`]}
    >
      <ConnectionsProvider>
        <Routes>
          <Route path="/step-functions/executions/:arn" element={<ExecutionDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  describeExecution.mockReset().mockResolvedValue(detail);
  getExecutionHistory.mockReset().mockResolvedValue(history);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ExecutionDetailPage", () => {
  it("shows status, input, output and history", async () => {
    renderPage();
    expect(await screen.findByTestId("exec-status")).toHaveTextContent("SUCCEEDED");
    expect(screen.getByTestId("exec-input-display")).toHaveTextContent('"hello": "world"');
    expect(screen.getByTestId("exec-output-display")).toHaveTextContent('"hello": "world"');
    await waitFor(() =>
      expect(screen.getByTestId("history-row-1")).toHaveTextContent("ExecutionStarted"),
    );
    expect(screen.getByTestId("history-row-4")).toHaveTextContent("ExecutionSucceeded");
  });

  it("resolves the execution ARN from the URL param", async () => {
    renderPage();
    await waitFor(() =>
      expect(describeExecution).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        EXEC_ARN,
      ),
    );
  });
});
