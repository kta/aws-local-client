import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { DbInstanceSummary } from "../../api/rds";

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

const listInstances = vi.fn();
const createInstance = vi.fn();
const deleteInstance = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    rds: {
      listInstances: (...args: unknown[]) => listInstances(...args),
      createInstance: (...args: unknown[]) => createInstance(...args),
      deleteInstance: (...args: unknown[]) => deleteInstance(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const instance = (id: string): DbInstanceSummary => ({
  id,
  engine: "mysql",
  status: "available",
  instanceClass: "db.t3.micro",
  endpointAddress: "localhost",
  endpointPort: 3306,
  allocatedStorage: 20,
});

import { ConnectionsProvider } from "../../state/connections";
import { InstancesPage } from "./InstancesPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/rds/instances"]}>
      <ConnectionsProvider>
        <InstancesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("InstancesPage list", () => {
  beforeEach(() => {
    listInstances.mockReset().mockResolvedValue([instance("db-1")]);
    createInstance.mockReset().mockResolvedValue(undefined);
    deleteInstance.mockReset().mockResolvedValue(undefined);
  });

  it("renders instances with endpoint and status", async () => {
    renderPage();
    expect(await screen.findByTestId("instance-row-db-1")).toBeInTheDocument();
    expect(screen.getByText("localhost:3306")).toBeInTheDocument();
    expect(screen.getByTestId("instances-create")).toBeInTheDocument();
  });

  it("creates an instance via the modal", async () => {
    renderPage();
    await screen.findByTestId("instance-row-db-1");

    fireEvent.click(screen.getByTestId("instances-create"));
    fireEvent.change(screen.getByTestId("i-id"), { target: { value: "new-db" } });
    fireEvent.change(screen.getByTestId("i-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("i-password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByTestId("i-save"));

    await waitFor(() =>
      expect(createInstance).toHaveBeenCalledWith(
        profiles[0],
        expect.objectContaining({
          id: "new-db",
          engine: "mysql",
          instanceClass: "db.t3.micro",
          masterUsername: "admin",
          masterPassword: "password123",
          allocatedStorage: 20,
        }),
      ),
    );
  });

  it("confirms deletion via the name-typed modal", async () => {
    renderPage();
    await screen.findByTestId("instance-row-db-1");

    fireEvent.click(screen.getByTestId("instances-delete"));
    const confirm = screen.getByTestId("instances-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("instances-delete-input"), { target: { value: "db-1" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(deleteInstance).toHaveBeenCalledWith(profiles[0], "db-1"));
  });
});

describe("InstancesPage unsupported (R34)", () => {
  beforeEach(() => {
    listInstances
      .mockReset()
      .mockRejectedValue(new Error("API for service 'rds' not yet implemented or pro feature"));
    createInstance.mockReset();
    deleteInstance.mockReset();
  });

  it("shows the unsupported banner and hides the create button", async () => {
    renderPage();
    expect(await screen.findByTestId("rds-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("instances-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});

describe("InstancesPage create failure (R35)", () => {
  beforeEach(() => {
    listInstances.mockReset().mockResolvedValue([instance("db-1")]);
    // A create error that is NOT an unsupported signature stays a normal banner.
    createInstance.mockReset().mockRejectedValue(new Error("InsufficientDBInstanceCapacity"));
    deleteInstance.mockReset();
  });

  it("shows a normal error banner, not the unsupported banner", async () => {
    renderPage();
    await screen.findByTestId("instance-row-db-1");

    fireEvent.click(screen.getByTestId("instances-create"));
    fireEvent.change(screen.getByTestId("i-id"), { target: { value: "new-db" } });
    fireEvent.change(screen.getByTestId("i-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("i-password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByTestId("i-save"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("rds-unsupported")).not.toBeInTheDocument();
    // The list is still visible alongside the error.
    expect(screen.getByTestId("instance-row-db-1")).toBeInTheDocument();
  });
});
