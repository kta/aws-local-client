import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { LayerSummary } from "../../api/lambda";
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

const sampleLayers: LayerSummary[] = [
  {
    name: "shared-libs",
    arn: "arn:layer",
    version: 2,
    versionArn: "arn:layer:2",
    description: null,
    createdDate: "2026-07-22T00:00:00Z",
    compatibleRuntimes: ["python3.12"],
  },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    lambda: {
      listLayers: (...args: unknown[]) => listLayers(...args),
      publishLayerVersion: (...args: unknown[]) => publishLayerVersion(...args),
      deleteLayerVersion: (...args: unknown[]) => deleteLayerVersion(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

const listLayers = vi.fn();
const publishLayerVersion = vi.fn();
const deleteLayerVersion = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { LayersPage } from "./LayersPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/lambda/layers"]}>
      <ConnectionsProvider>
        <LayersPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH = "/seam/layer.zip";
  listLayers.mockReset().mockResolvedValue(sampleLayers);
  publishLayerVersion.mockReset().mockResolvedValue(undefined);
  deleteLayerVersion.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH;
  vi.clearAllMocks();
});

describe("Lambda LayersPage (R55)", () => {
  it("lists layers with name, version and runtimes", async () => {
    renderPage();
    expect(await screen.findByTestId("layer-name-shared-libs")).toBeInTheDocument();
    expect(screen.getByText("python3.12")).toBeInTheDocument();
  });

  it("publishes a layer via the zip seam", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("layer-publish"));
    fireEvent.change(await screen.findByTestId("layer-name"), { target: { value: "new-layer" } });
    fireEvent.click(screen.getByTestId("layer-zip"));
    await waitFor(() => expect(screen.getByTestId("layer-zip-name")).toHaveTextContent("layer.zip"));
    fireEvent.click(screen.getByTestId("layer-save"));

    await waitFor(() =>
      expect(publishLayerVersion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({
          name: "new-layer",
          zipPath: "/seam/layer.zip",
          compatibleRuntimes: ["python3.12"],
        }),
      ),
    );
  });

  it("deletes a layer version after confirming the name", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("shared-libs を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("layers-delete"));

    fireEvent.change(screen.getByTestId("layer-delete-input"), { target: { value: "shared-libs" } });
    fireEvent.click(screen.getByTestId("layer-delete-confirm"));

    await waitFor(() =>
      expect(deleteLayerVersion).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "shared-libs",
        2,
      ),
    );
  });

  it("shows the unsupported banner when the layers API is unsupported", async () => {
    listLayers.mockRejectedValue({ kind: "internal", message: "NoSuchBucket" });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("lambda-layers-unsupported")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("layer-publish")).not.toBeInTheDocument();
  });

  it("shows a normal error banner for a non-unsupported error", async () => {
    listLayers.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("lambda-layers-unsupported")).not.toBeInTheDocument();
  });
});
