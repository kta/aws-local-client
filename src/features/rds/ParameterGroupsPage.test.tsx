import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { DbParameter, DbParameterGroup, ListParametersResult } from "../../api/rds";

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

const listParameterGroups = vi.fn();
const createParameterGroup = vi.fn();
const deleteParameterGroup = vi.fn();
const listParameters = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    rds: {
      listParameterGroups: (...args: unknown[]) => listParameterGroups(...args),
      createParameterGroup: (...args: unknown[]) => createParameterGroup(...args),
      deleteParameterGroup: (...args: unknown[]) => deleteParameterGroup(...args),
      listParameters: (...args: unknown[]) => listParameters(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const group = (name: string): DbParameterGroup => ({
  name,
  family: "mysql8.0",
  description: "test",
});

const param = (name: string): DbParameter => ({ name, value: "1", description: "d" });

const paramsResult = (params: DbParameter[], marker: string | null): ListParametersResult => ({
  parameters: params,
  marker,
});

import { ConnectionsProvider } from "../../state/connections";
import { ParameterGroupsPage } from "./ParameterGroupsPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/rds/parameter-groups"]}>
      <ConnectionsProvider>
        <ParameterGroupsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("ParameterGroupsPage (R50)", () => {
  beforeEach(() => {
    listParameterGroups.mockReset().mockResolvedValue([group("pg-1")]);
    createParameterGroup.mockReset().mockResolvedValue(undefined);
    deleteParameterGroup.mockReset().mockResolvedValue(undefined);
    listParameters.mockReset().mockResolvedValue(paramsResult([param("max_connections")], null));
  });

  it("lists parameter groups", async () => {
    renderPage();
    expect(await screen.findByTestId("pgroup-row-pg-1")).toBeInTheDocument();
    expect(screen.getByTestId("pgroups-table")).toBeInTheDocument();
  });

  it("creates a parameter group via the modal", async () => {
    renderPage();
    await screen.findByTestId("pgroup-row-pg-1");

    fireEvent.click(screen.getByTestId("pgroups-create"));
    fireEvent.change(screen.getByTestId("pg-name"), { target: { value: "new-pg" } });
    fireEvent.change(screen.getByTestId("pg-desc"), { target: { value: "my group" } });
    fireEvent.click(screen.getByTestId("pg-save"));

    await waitFor(() =>
      expect(createParameterGroup).toHaveBeenCalledWith(
        profiles[0],
        "new-pg",
        "mysql8.0",
        "my group",
      ),
    );
  });

  it("shows parameters when a group row is clicked", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("pgroup-row-pg-1"));

    await waitFor(() => expect(screen.getByTestId("pg-params-table")).toBeInTheDocument());
    expect(screen.getByText("max_connections")).toBeInTheDocument();
    expect(listParameters).toHaveBeenCalledWith(profiles[0], "pg-1", undefined);
  });

  it("loads more parameters via the continuation marker", async () => {
    listParameters
      .mockReset()
      .mockResolvedValueOnce(paramsResult([param("p1")], "m1"))
      .mockResolvedValueOnce(paramsResult([param("p2")], null));

    renderPage();
    fireEvent.click(await screen.findByTestId("pgroup-row-pg-1"));
    await waitFor(() => expect(screen.getByText("p1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pg-params-more"));
    await waitFor(() => expect(screen.getByText("p2")).toBeInTheDocument());
    expect(listParameters).toHaveBeenLastCalledWith(profiles[0], "pg-1", "m1");
  });

  it("deletes a parameter group after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByTestId("pgroup-row-pg-1");

    fireEvent.click(screen.getByTestId("pgroups-delete"));
    await waitFor(() => expect(deleteParameterGroup).toHaveBeenCalledWith(profiles[0], "pg-1"));
  });

  it("shows the parameter-groups-unsupported banner when unsupported", async () => {
    listParameterGroups.mockReset().mockRejectedValue(new Error("API not yet implemented"));
    renderPage();
    expect(await screen.findByTestId("parameter-groups-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("pgroups-create")).not.toBeInTheDocument();
  });
});
