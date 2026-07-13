import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import App from "./App";

// Web build "動作確認" (see plan Global Constraints): the Tauri backend is not
// available in a plain browser build, so we exercise the UI against a mocked
// IPC backend using @tauri-apps/api/mocks. This asserts that the app boots to
// its entry screen (接続管理) with zero connection profiles.
describe("web smoke (mocked backend)", () => {
  afterEach(() => {
    clearMocks();
  });

  it("renders the 接続管理 entry screen with an empty backend", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "list_connections":
          return [];
        case "detect_connections":
          return [];
        case "ddb_list_tables":
          return [];
        default:
          return undefined;
      }
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "接続管理" })).toBeInTheDocument(),
    );
    expect(screen.getByText("接続がまだ登録されていません")).toBeInTheDocument();
  });
});
