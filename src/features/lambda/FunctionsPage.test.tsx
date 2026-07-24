import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { FunctionSummary } from "../../api/lambda";
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

const sampleFns: FunctionSummary[] = [
  {
    name: "hello",
    runtime: "python3.12",
    handler: "index.handler",
    description: null,
    codeSize: 512,
    memorySize: 128,
    timeout: 3,
    lastModified: "2026-07-22T00:00:00Z",
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    lambda: {
      listFunctions: (...args: unknown[]) => listFunctions(...args),
      createFunction: (...args: unknown[]) => createFunction(...args),
      deleteFunction: (...args: unknown[]) => deleteFunction(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

// The create modal uses the dialog plugin; the E2E seam bypasses it in-app, but
// unit tests inject the path via window.__E2E_UPLOAD_PATH.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

const listFunctions = vi.fn();
const createFunction = vi.fn();
const deleteFunction = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { FunctionsPage } from "./FunctionsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/lambda/functions"]}>
      <ConnectionsProvider>
        <FunctionsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH = "/seam/fn.zip";
  listFunctions.mockReset().mockResolvedValue(sampleFns);
  createFunction.mockReset().mockResolvedValue(undefined);
  deleteFunction.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH;
  vi.clearAllMocks();
});

describe("Lambda FunctionsPage (R52)", () => {
  it("renders function rows with name, runtime and handler", async () => {
    renderPage();
    expect(await screen.findByTestId("fn-link-hello")).toBeInTheDocument();
    expect(screen.getByText("python3.12")).toBeInTheDocument();
    expect(screen.getByText("index.handler")).toBeInTheDocument();
  });

  it("creates a function (name/runtime/handler/zip) and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("lambda-create");

    fireEvent.click(screen.getByTestId("lambda-create"));
    fireEvent.change(await screen.findByTestId("fn-name"), { target: { value: "new-fn" } });
    fireEvent.change(screen.getByTestId("fn-handler"), { target: { value: "app.handler" } });
    // Pick a zip via the seam.
    fireEvent.click(screen.getByTestId("fn-zip"));
    await waitFor(() => expect(screen.getByTestId("fn-zip-name")).toHaveTextContent("fn.zip"));

    fireEvent.click(screen.getByTestId("fn-save"));

    await waitFor(() =>
      expect(createFunction).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({
          name: "new-fn",
          runtime: "python3.12",
          handler: "app.handler",
          zipPath: "/seam/fn.zip",
        }),
      ),
    );
    await waitFor(() => expect(listFunctions).toHaveBeenCalledTimes(2));
  });

  it("disables save until name and zip are provided", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("lambda-create"));
    expect(await screen.findByTestId("fn-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("fn-name"), { target: { value: "x" } });
    // handler has a default; still need a zip.
    expect(screen.getByTestId("fn-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("fn-zip"));
    await waitFor(() => expect(screen.getByTestId("fn-save")).not.toBeDisabled());
  });

  it("deletes a function after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("hello を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("functions-delete"));

    const confirm = screen.getByTestId("lambda-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("lambda-delete-input"), { target: { value: "hello" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteFunction).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "hello"),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listFunctions.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listFunctions).not.toHaveBeenCalled();
  });
});
