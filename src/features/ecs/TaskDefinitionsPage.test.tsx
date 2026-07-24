import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { RegisterTaskDefResult, TaskDefinitionSummary } from "../../api/ecs";
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

const listTaskDefinitions = vi.fn();
const registerTaskDefinition = vi.fn();
const describeTaskDefinition = vi.fn();
const deregisterTaskDefinition = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ecs: {
      listTaskDefinitions: (...args: unknown[]) => listTaskDefinitions(...args),
      registerTaskDefinition: (...args: unknown[]) => registerTaskDefinition(...args),
      describeTaskDefinition: (...args: unknown[]) => describeTaskDefinition(...args),
      deregisterTaskDefinition: (...args: unknown[]) => deregisterTaskDefinition(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const sample: TaskDefinitionSummary[] = [
  { arn: "arn:aws:ecs:::task-definition/web:1", family: "web", revision: 1 },
];

import { ConnectionsProvider } from "../../state/connections";
import { TaskDefinitionsPage } from "./TaskDefinitionsPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/ecs/task-definitions"]}>
      <ConnectionsProvider>
        <TaskDefinitionsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  listTaskDefinitions.mockReset().mockResolvedValue(sample);
  registerTaskDefinition.mockReset();
  describeTaskDefinition.mockReset();
  deregisterTaskDefinition.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("ECS TaskDefinitionsPage (R76)", () => {
  it("lists task definition families and revisions", async () => {
    renderPage();
    expect(await screen.findByTestId("ecs-taskdef-row-web:1")).toBeInTheDocument();
  });

  it("registers a task definition and notes ignored keys", async () => {
    const result: RegisterTaskDefResult = {
      arn: "arn:aws:ecs:::task-definition/new:1",
      family: "new",
      revision: 1,
      ignoredKeys: ["portMappings"],
    };
    registerTaskDefinition.mockResolvedValue(result);
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-taskdef-register"));
    fireEvent.change(await screen.findByTestId("ecs-taskdef-family"), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByTestId("ecs-taskdef-save"));
    await waitFor(() => expect(registerTaskDefinition).toHaveBeenCalled());
    expect(await screen.findByTestId("ecs-taskdef-note")).toHaveTextContent("portMappings");
  });

  it("opens the detail modal showing container definitions", async () => {
    describeTaskDefinition.mockResolvedValue({
      arn: "arn:aws:ecs:::task-definition/web:1",
      family: "web",
      revision: 1,
      status: "ACTIVE",
      registeredAt: null,
      containers: [
        { name: "app", image: "busybox", memory: 128, cpu: null, essential: true, command: ["sleep"] },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-taskdef-row-web:1"));
    expect(await screen.findByTestId("ecs-taskdef-detail")).toBeInTheDocument();
    expect(screen.getByTestId("ecs-container-row-app")).toHaveTextContent("busybox");
  });

  it("deregisters a task definition after typing the family name", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-taskdef-deregister-web:1"));
    const confirm = screen.getByTestId("ecs-taskdef-deregister-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("ecs-taskdef-deregister-input"), {
      target: { value: "web" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deregisterTaskDefinition).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "arn:aws:ecs:::task-definition/web:1",
      ),
    );
  });

  it("shows the ecs-unsupported banner when list is unsupported", async () => {
    listTaskDefinitions.mockRejectedValue(new Error("API for service 'ecs' not yet implemented"));
    renderPage();
    expect(await screen.findByTestId("ecs-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("ecs-taskdef-register")).not.toBeInTheDocument();
  });
});
