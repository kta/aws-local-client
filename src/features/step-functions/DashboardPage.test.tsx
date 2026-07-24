import { render, screen, waitFor } from "@testing-library/react";
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
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    stepfunctions: {
      listStateMachines: (...args: unknown[]) => listStateMachines(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listStateMachines = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/step-functions"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listStateMachines.mockReset().mockResolvedValue(sampleMachines);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("step-functions DashboardPage", () => {
  it("summarises state machines", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("sfn-dash-machines")).toHaveTextContent("1"));
    expect(screen.getByTestId("sfn-dash-standard")).toHaveTextContent("1");
  });

  it("shows the unsupported banner when the list fails with unsupported", async () => {
    listStateMachines.mockRejectedValue({
      kind: "internal",
      message: "The action ListStateMachines is not valid for this endpoint",
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("step-functions-unsupported")).toBeInTheDocument(),
    );
  });
});
