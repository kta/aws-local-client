import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { FunctionDetail, InvokeResult } from "../../api/lambda";
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

const detail: FunctionDetail = {
  name: "hello",
  runtime: "python3.12",
  handler: "index.handler",
  description: "d",
  role: "arn:aws:iam::000000000000:role/nlsd-dummy",
  codeSize: 512,
  memorySize: 128,
  timeout: 3,
  codeSha256: "sha-abc",
  lastModified: "2026-07-22T00:00:00Z",
  environment: [{ key: "FOO", value: "bar" }],
};

const getFunction = vi.fn();
const updateFunctionConfig = vi.fn();
const updateFunctionCode = vi.fn();
const invokeFn = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    lambda: {
      getFunction: (...args: unknown[]) => getFunction(...args),
      updateFunctionConfig: (...args: unknown[]) => updateFunctionConfig(...args),
      updateFunctionCode: (...args: unknown[]) => updateFunctionCode(...args),
      invoke: (...args: unknown[]) => invokeFn(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { ConnectionsProvider } from "../../state/connections";
import { FunctionDetailPage } from "./FunctionDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/lambda/functions/hello"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/lambda/functions/:name" element={<FunctionDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH = "/seam/new.zip";
  getFunction.mockReset().mockResolvedValue(detail);
  updateFunctionConfig.mockReset().mockResolvedValue(undefined);
  updateFunctionCode.mockReset().mockResolvedValue(undefined);
  invokeFn.mockReset();
});

afterEach(() => {
  delete (window as { __E2E_UPLOAD_PATH?: string }).__E2E_UPLOAD_PATH;
  vi.clearAllMocks();
});

describe("Lambda FunctionDetailPage (R53/R54)", () => {
  it("shows the overview tab with runtime, memory, timeout and env vars", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("fn-ov-runtime")).toHaveTextContent("python3.12"));
    expect(screen.getByTestId("fn-ov-memory")).toHaveTextContent("128");
    expect(screen.getByTestId("fn-ov-timeout")).toHaveTextContent("3");
    expect(screen.getByTestId("fn-ov-env-FOO")).toHaveTextContent("FOO = bar");
  });

  it("edits configuration (memory/timeout/env) and saves", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-config"));
    await waitFor(() => expect(screen.getByTestId("fn-cfg-memory")).toHaveValue(128));

    fireEvent.change(screen.getByTestId("fn-cfg-memory"), { target: { value: "256" } });
    fireEvent.change(screen.getByTestId("fn-cfg-timeout"), { target: { value: "15" } });
    fireEvent.click(screen.getByTestId("fn-cfg-save"));

    await waitFor(() =>
      expect(updateFunctionConfig).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "hello",
        expect.objectContaining({
          memorySize: 256,
          timeout: 15,
          environment: [{ key: "FOO", value: "bar" }],
        }),
      ),
    );
  });

  it("re-uploads code via the zip seam", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-code"));
    await waitFor(() => expect(screen.getByTestId("fn-code-sha")).toHaveTextContent("sha-abc"));

    fireEvent.click(screen.getByTestId("fn-code-zip"));
    await waitFor(() => expect(screen.getByTestId("fn-code-zip-name")).toHaveTextContent("new.zip"));
    fireEvent.click(screen.getByTestId("fn-code-upload"));

    await waitFor(() =>
      expect(updateFunctionCode).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "hello",
        "/seam/new.zip",
      ),
    );
  });

  it("invokes on the test tab and shows status, payload and logs", async () => {
    const result: InvokeResult = {
      statusCode: 200,
      payload: '{"ok": true, "echo": {"key": "value"}}',
      functionError: null,
      logTail: "START RequestId...",
    };
    invokeFn.mockResolvedValue(result);

    renderPage();
    fireEvent.click(await screen.findByTestId("tab-test"));
    fireEvent.click(screen.getByTestId("fn-invoke"));

    await waitFor(() => expect(screen.getByTestId("fn-invoke-status")).toHaveTextContent("200"));
    expect(screen.getByTestId("fn-invoke-payload")).toHaveTextContent('"echo"');
    expect(screen.getByTestId("fn-invoke-logs")).toHaveTextContent("START RequestId");
  });

  it("shows an error banner when invoke is unsupported", async () => {
    invokeFn.mockRejectedValue({ kind: "internal", message: "no runtime handler" });

    renderPage();
    fireEvent.click(await screen.findByTestId("tab-test"));
    fireEvent.click(screen.getByTestId("fn-invoke"));

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });
});
