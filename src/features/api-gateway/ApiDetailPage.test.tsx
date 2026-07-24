import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ApiResource, ApiSummary, StageSummary } from "../../api/apigateway";
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

const listApis = vi.fn();
const getResources = vi.fn();
const createResource = vi.fn();
const putMethod = vi.fn();
const listStages = vi.fn();
const createDeployment = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    apigateway: {
      listApis: (...args: unknown[]) => listApis(...args),
      getResources: (...args: unknown[]) => getResources(...args),
      createResource: (...args: unknown[]) => createResource(...args),
      putMethod: (...args: unknown[]) => putMethod(...args),
      listStages: (...args: unknown[]) => listStages(...args),
      createDeployment: (...args: unknown[]) => createDeployment(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const apis: ApiSummary[] = [{ id: "a1", name: "orders", description: null, createdDate: null }];
const resources: ApiResource[] = [
  { id: "root", path: "/", parentId: null, methods: [] },
  { id: "res1", path: "/demo", parentId: "root", methods: ["GET"] },
];
const stages: StageSummary[] = [{ stageName: "dev", deploymentId: "d1", createdDate: null }];

import { ConnectionsProvider } from "../../state/connections";
import { ApiDetailPage } from "./ApiDetailPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/api-gateway/apis/a1"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/api-gateway/apis/:id" element={<ApiDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  listApis.mockReset().mockResolvedValue(apis);
  getResources.mockReset().mockResolvedValue(resources);
  createResource.mockReset().mockResolvedValue(resources[1]);
  putMethod.mockReset().mockResolvedValue(undefined);
  listStages.mockReset().mockResolvedValue(stages);
  createDeployment.mockReset().mockResolvedValue(stages[0]);
});

afterEach(() => vi.clearAllMocks());

describe("ApiDetailPage (R57/R58)", () => {
  it("renders the resource tree with methods", async () => {
    renderPage();
    // The resource row loads asynchronously; wait for it rather than the static
    // table shell to avoid racing the fetch.
    await waitFor(() => expect(screen.getByText("/demo")).toBeInTheDocument());
    expect(screen.getByTestId("resources-tree")).toBeInTheDocument();
    expect(screen.getByTestId("method-badge-res1-GET")).toHaveTextContent("GET");
  });

  it("creates a resource under a parent", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("resource-create"));
    fireEvent.change(await screen.findByTestId("resource-path-part"), {
      target: { value: "users" },
    });
    fireEvent.click(screen.getByTestId("resource-save"));
    await waitFor(() =>
      expect(createResource).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "a1",
        "root",
        "users",
      ),
    );
  });

  it("creates a MOCK method on a resource", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("method-create"));
    // resource select defaults to first (root); pick /demo
    fireEvent.change(await screen.findByTestId("method-resource"), { target: { value: "res1" } });
    fireEvent.click(screen.getByTestId("method-save"));
    await waitFor(() =>
      expect(putMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "a1",
        "res1",
        "GET",
        expect.objectContaining({ kind: "mock" }),
      ),
    );
  });

  it("lists stages with a reference invoke URL and creates a deployment", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-stages"));
    await waitFor(() => expect(screen.getByTestId("stage-name-dev")).toBeInTheDocument());
    expect(screen.getByTestId("invoke-url-dev")).toHaveTextContent("/restapis/a1/dev/");

    fireEvent.click(screen.getByTestId("stage-deploy"));
    fireEvent.change(await screen.findByTestId("deploy-stage-name"), { target: { value: "prod" } });
    fireEvent.click(screen.getByTestId("deploy-save"));
    await waitFor(() =>
      expect(createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "a1",
        "prod",
      ),
    );
  });
});
