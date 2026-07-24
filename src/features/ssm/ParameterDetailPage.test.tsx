import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ParameterHistoryEntry, ParameterValue } from "../../api/ssm";
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

const secureDetail: ParameterValue = {
  name: "/app/db/password",
  type: "SecureString",
  value: "s3cret",
  version: 2,
};

const history: ParameterHistoryEntry[] = [
  { version: 2, value: "s3cret", type: "SecureString", lastModified: null },
  { version: 1, value: "old", type: "SecureString", lastModified: null },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    ssm: {
      getParameter: (...args: unknown[]) => getParameter(...args),
      getParameterHistory: (...args: unknown[]) => getParameterHistory(...args),
      putParameter: (...args: unknown[]) => putParameter(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const getParameter = vi.fn();
const getParameterHistory = vi.fn();
const putParameter = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { ParameterDetailPage } from "./ParameterDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ssm/parameters/%2Fapp%2Fdb%2Fpassword"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/ssm/parameters/:name" element={<ParameterDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getParameter.mockReset().mockResolvedValue(secureDetail);
  getParameterHistory.mockReset().mockResolvedValue(history);
  putParameter.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ParameterDetailPage", () => {
  it("masks a SecureString value and reveals it on toggle", async () => {
    renderPage();
    const value = await screen.findByTestId("ssm-value");
    expect(value).toHaveTextContent("●●●●●●●●");
    expect(value).not.toHaveTextContent("s3cret");

    fireEvent.click(screen.getByTestId("ssm-value-toggle"));
    await waitFor(() => expect(screen.getByTestId("ssm-value")).toHaveTextContent("s3cret"));
  });

  it("renders the version history table with v1 and v2", async () => {
    renderPage();
    expect(await screen.findByTestId("ssm-history-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("ssm-history-row-1")).toBeInTheDocument();
  });

  it("overwrites the value with overwrite=true and reloads", async () => {
    renderPage();
    const editor = await screen.findByTestId("ssm-update-value");
    fireEvent.change(editor, { target: { value: "next" } });
    fireEvent.click(screen.getByTestId("ssm-update-save"));

    await waitFor(() =>
      expect(putParameter).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({
          name: "/app/db/password",
          value: "next",
          type: "SecureString",
          overwrite: true,
        }),
      ),
    );
  });

  it("shows the unsupported notice when history is not implemented", async () => {
    getParameterHistory.mockRejectedValue({
      kind: "validation",
      message: "The action GetParameterHistory is not valid",
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("ssm-history-unsupported")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ssm-history-table")).not.toBeInTheDocument();
  });
});
