import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  CfnEventsResult,
  CfnResource,
  CfnStackDetail,
} from "../../api/cloudformation";
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

const sampleDetail: CfnStackDetail = {
  name: "app-stack",
  status: "CREATE_COMPLETE",
  statusReason: null,
  createdAt: null,
  updatedAt: null,
  outputs: [{ key: "TopicArn", value: "arn:aws:sns:...", description: null, exportName: "T" }],
  parameters: [{ key: "Env", value: "prod" }],
};

const sampleResources: CfnResource[] = [
  {
    logicalId: "MyTopic",
    physicalId: "arn:aws:sns:...",
    resourceType: "AWS::SNS::Topic",
    status: "CREATE_COMPLETE",
    timestamp: null,
  },
];

let eventsResult: CfnEventsResult = { events: [], supported: true };

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cloudformation: {
      getStack: (...args: unknown[]) => getStack(...args),
      listResources: (...args: unknown[]) => listResources(...args),
      listEvents: (...args: unknown[]) => listEvents(...args),
      getTemplate: (...args: unknown[]) => getTemplate(...args),
      updateStack: (...args: unknown[]) => updateStack(...args),
      deleteStack: (...args: unknown[]) => deleteStack(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const getStack = vi.fn();
const listResources = vi.fn();
const listEvents = vi.fn();
const getTemplate = vi.fn();
const updateStack = vi.fn();
const deleteStack = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { StackDetailPage } from "./StackDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudformation/stacks/app-stack"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/cloudformation/stacks/:name" element={<StackDetailPage />} />
          <Route path="/cloudformation/stacks" element={<div>stacks list</div>} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  eventsResult = { events: [], supported: true };
  getStack.mockReset().mockResolvedValue(sampleDetail);
  listResources.mockReset().mockResolvedValue(sampleResources);
  listEvents.mockReset().mockImplementation(async () => eventsResult);
  getTemplate.mockReset().mockResolvedValue('{"Resources":{}}');
  updateStack.mockReset().mockResolvedValue(undefined);
  deleteStack.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("StackDetailPage", () => {
  it("shows the resources tab with the stack's resources by default", async () => {
    renderPage();
    expect(await screen.findByTestId("resource-row-MyTopic")).toBeInTheDocument();
    expect(screen.getByText("AWS::SNS::Topic")).toBeInTheDocument();
  });

  it("shows outputs and parameters tabs", async () => {
    renderPage();
    await screen.findByTestId("resource-row-MyTopic");
    fireEvent.click(screen.getByTestId("tab-outputs"));
    expect(await screen.findByTestId("output-row-TopicArn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-parameters"));
    expect(await screen.findByTestId("parameter-row-Env")).toBeInTheDocument();
  });

  it("shows the template tab content", async () => {
    renderPage();
    await screen.findByTestId("resource-row-MyTopic");
    fireEvent.click(screen.getByTestId("tab-template"));
    await waitFor(() =>
      expect(screen.getByTestId("template-body")).toHaveTextContent('"Resources"'),
    );
  });

  it("shows the events-unsupported notice when events are unsupported", async () => {
    eventsResult = { events: [], supported: false };
    renderPage();
    await screen.findByTestId("resource-row-MyTopic");
    fireEvent.click(screen.getByTestId("tab-events"));
    expect(await screen.findByTestId("events-unsupported")).toBeInTheDocument();
  });

  it("updates the stack via the update modal", async () => {
    renderPage();
    // The update button is disabled until the stack detail loads.
    await screen.findByTestId("stack-detail-status");
    fireEvent.click(screen.getByTestId("stack-update"));
    fireEvent.change(await screen.findByTestId("cfn-template"), {
      target: { value: '{"Resources":{"X":{}}}' },
    });
    fireEvent.click(screen.getByTestId("cfn-save"));
    await waitFor(() =>
      expect(updateStack).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "app-stack",
        '{"Resources":{"X":{}}}',
        [{ key: "Env", value: "prod" }],
      ),
    );
  });

  it("deletes the stack after name confirmation", async () => {
    renderPage();
    await screen.findByTestId("stack-delete");
    fireEvent.click(screen.getByTestId("stack-delete"));
    const confirm = screen.getByTestId("stack-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("stack-delete-input"), { target: { value: "app-stack" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteStack).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "app-stack"),
    );
  });
});
