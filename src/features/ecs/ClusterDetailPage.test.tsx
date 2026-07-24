import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ServiceSummary, TaskDefinitionSummary, TaskSummary } from "../../api/ecs";
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

const listServices = vi.fn();
const createService = vi.fn();
const updateService = vi.fn();
const deleteService = vi.fn();
const listTasks = vi.fn();
const runTask = vi.fn();
const stopTask = vi.fn();
const listTaskDefinitions = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ecs: {
      listServices: (...args: unknown[]) => listServices(...args),
      createService: (...args: unknown[]) => createService(...args),
      updateService: (...args: unknown[]) => updateService(...args),
      deleteService: (...args: unknown[]) => deleteService(...args),
      listTasks: (...args: unknown[]) => listTasks(...args),
      runTask: (...args: unknown[]) => runTask(...args),
      stopTask: (...args: unknown[]) => stopTask(...args),
      listTaskDefinitions: (...args: unknown[]) => listTaskDefinitions(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const service: ServiceSummary = {
  name: "svc",
  arn: "arn:aws:ecs:::service/web/svc",
  status: "ACTIVE",
  taskDefinition: "web:1",
  desiredCount: 0,
  runningCount: 0,
  pendingCount: 0,
};

const task: TaskSummary = {
  arn: "arn:aws:ecs:::task/web/abc123",
  id: "abc123",
  taskDefinitionArn: "web:1",
  lastStatus: "RUNNING",
  desiredStatus: "RUNNING",
};

const taskDef: TaskDefinitionSummary = {
  arn: "arn:aws:ecs:::task-definition/web:1",
  family: "web",
  revision: 1,
};

import { ConnectionsProvider } from "../../state/connections";
import { ClusterDetailPage } from "./ClusterDetailPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/ecs/clusters/web"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/ecs/clusters/:name" element={<ClusterDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  listServices.mockReset().mockResolvedValue([service]);
  createService.mockReset().mockResolvedValue(undefined);
  updateService.mockReset().mockResolvedValue(undefined);
  deleteService.mockReset().mockResolvedValue(undefined);
  listTasks.mockReset().mockResolvedValue([task]);
  runTask.mockReset().mockResolvedValue(undefined);
  stopTask.mockReset().mockResolvedValue(undefined);
  listTaskDefinitions.mockReset().mockResolvedValue([taskDef]);
});
afterEach(() => vi.clearAllMocks());

describe("ECS ClusterDetailPage (R77)", () => {
  it("lists services on the services tab", async () => {
    renderPage();
    expect(await screen.findByText("svc")).toBeInTheDocument();
  });

  it("creates a service with a task definition and desired count", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-service-create"));
    fireEvent.change(await screen.findByTestId("csvc-name"), { target: { value: "new-svc" } });
    fireEvent.change(screen.getByTestId("csvc-desired"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("csvc-save"));
    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "web",
        "new-svc",
        taskDef.arn,
        1,
      ),
    );
  });

  it("edits a service desired count", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-service-edit-svc"));
    fireEvent.change(await screen.findByTestId("ecs-service-desired"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("ecs-service-desired-save"));
    await waitFor(() =>
      expect(updateService).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "web",
        "svc",
        3,
      ),
    );
  });

  it("deletes a service after typing its name", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-service-delete-svc"));
    fireEvent.change(screen.getByTestId("ecs-service-delete-input"), { target: { value: "svc" } });
    fireEvent.click(screen.getByTestId("ecs-service-delete-confirm"));
    await waitFor(() =>
      expect(deleteService).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "web", "svc"),
    );
  });

  it("runs a task and lists it, then stops it", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("ecs-tab-tasks"));
    expect(await screen.findByTestId("ecs-task-row-abc123")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ecs-task-run"));
    fireEvent.click(await screen.findByTestId("ecs-task-run-confirm"));
    await waitFor(() =>
      expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "web", taskDef.arn),
    );

    fireEvent.click(screen.getByTestId("ecs-task-stop-abc123"));
    await waitFor(() =>
      expect(stopTask).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "web", task.arn),
    );
  });

  it("shows the services/tasks unsupported notices when list ops are unsupported", async () => {
    listServices.mockRejectedValue(new Error("UnknownOperationException"));
    listTasks.mockRejectedValue(new Error("UnknownOperationException"));
    renderPage();
    expect(await screen.findByTestId("ecs-services-unsupported")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ecs-tab-tasks"));
    expect(await screen.findByTestId("ecs-tasks-unsupported")).toBeInTheDocument();
  });
});
