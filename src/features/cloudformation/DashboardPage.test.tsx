import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { CfnExport, CfnStackSummary } from "../../api/cloudformation";
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
  { name: "bad-stack", status: "ROLLBACK_FAILED", statusReason: null, createdAt: null },
];

const sampleExports: CfnExport[] = [
  { name: "TopicArn", value: "arn:aws:sns:...", exportingStackId: null },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cloudformation: {
      listStacks: (...args: unknown[]) => listStacks(...args),
      listExports: (...args: unknown[]) => listExports(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listStacks = vi.fn();
const listExports = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudformation"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listStacks.mockReset().mockResolvedValue(sampleStacks);
  listExports.mockReset().mockResolvedValue(sampleExports);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CloudFormation DashboardPage", () => {
  it("shows summary counts matching the loaded stacks and exports", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cfn-dash-stacks")).toHaveTextContent("2"));
    expect(screen.getByTestId("cfn-dash-complete")).toHaveTextContent("1");
    expect(screen.getByTestId("cfn-dash-failed")).toHaveTextContent("1");
    expect(screen.getByTestId("cfn-dash-exports")).toHaveTextContent("1");
  });

  it("degrades the exports card to '-' when ListExports is unsupported", async () => {
    listExports.mockRejectedValue({ kind: "internal", message: "not supported" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("cfn-dash-stacks")).toHaveTextContent("2"));
    expect(screen.getByTestId("cfn-dash-exports")).toHaveTextContent("-");
  });

  it("shows the error banner when listing stacks fails", async () => {
    listStacks.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });
});
