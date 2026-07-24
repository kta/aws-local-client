import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ParameterSummary } from "../../api/ssm";
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

const sampleParams: ParameterSummary[] = [
  { name: "/app/db/password", type: "SecureString", version: 2, lastModified: null },
  { name: "/app/feature/flag", type: "String", version: 1, lastModified: null },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    ssm: {
      listParameters: (...args: unknown[]) => listParameters(...args),
      putParameter: (...args: unknown[]) => putParameter(...args),
      deleteParameter: (...args: unknown[]) => deleteParameter(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listParameters = vi.fn();
const putParameter = vi.fn();
const deleteParameter = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { ParametersPage } from "./ParametersPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ssm/parameters"]}>
      <ConnectionsProvider>
        <ParametersPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listParameters.mockReset().mockResolvedValue(sampleParams);
  putParameter.mockReset().mockResolvedValue(undefined);
  deleteParameter.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ParametersPage", () => {
  it("renders parameter rows with name, type and version", async () => {
    renderPage();
    expect(await screen.findByTestId("param-link-/app/db/password")).toBeInTheDocument();
    expect(screen.getByTestId("param-link-/app/feature/flag")).toBeInTheDocument();
    expect(screen.getByText("SecureString")).toBeInTheDocument();
    expect(screen.getByTestId("param-version-/app/db/password")).toHaveTextContent("2");
  });

  it("creates a parameter and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("params-create");

    fireEvent.click(screen.getByTestId("params-create"));
    fireEvent.change(await screen.findByTestId("param-name"), { target: { value: "/new/p" } });
    fireEvent.change(screen.getByTestId("param-value"), { target: { value: "hello" } });
    fireEvent.change(screen.getByTestId("param-type"), { target: { value: "String" } });
    fireEvent.click(screen.getByTestId("param-save"));

    await waitFor(() =>
      expect(putParameter).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({
          name: "/new/p",
          value: "hello",
          type: "String",
          overwrite: false,
        }),
      ),
    );
    await waitFor(() => expect(listParameters).toHaveBeenCalledTimes(2));
  });

  it("applies the prefix filter by re-fetching with the prefix", async () => {
    renderPage();
    await screen.findByTestId("param-link-/app/db/password");

    fireEvent.change(screen.getByTestId("ssm-prefix-filter"), { target: { value: "/app/db" } });
    fireEvent.click(screen.getByTestId("ssm-prefix-apply"));

    await waitFor(() =>
      expect(listParameters).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "1" }),
        "/app/db",
      ),
    );
  });

  it("deletes a parameter after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("/app/db/password を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("params-delete"));

    const confirm = screen.getByTestId("params-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("params-delete-input"), {
      target: { value: "/app/db/password" },
    });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteParameter).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/app/db/password",
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listParameters.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listParameters).not.toHaveBeenCalled();
  });
});
