import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ApiSummary } from "../../api/apigateway";
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

const sampleApis: ApiSummary[] = [
  { id: "a1", name: "orders", description: "orders api", createdDate: null },
  { id: "a2", name: "users", description: null, createdDate: null },
];

let noProfiles = false;

const listApis = vi.fn();
const createApi = vi.fn();
const deleteApi = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    apigateway: {
      listApis: (...args: unknown[]) => listApis(...args),
      createApi: (...args: unknown[]) => createApi(...args),
      deleteApi: (...args: unknown[]) => deleteApi(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { ConnectionsProvider } from "../../state/connections";
import { ApisPage } from "./ApisPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/api-gateway/apis"]}>
      <ConnectionsProvider>
        <ApisPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  noProfiles = false;
  listApis.mockReset().mockResolvedValue(sampleApis);
  createApi.mockReset().mockResolvedValue(sampleApis[0]);
  deleteApi.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("ApisPage (R56)", () => {
  it("renders API rows", async () => {
    renderPage();
    expect(await screen.findByTestId("api-link-a1")).toHaveTextContent("orders");
    expect(screen.getByTestId("api-link-a2")).toHaveTextContent("users");
  });

  it("creates an API and reloads the list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("apis-create"));
    fireEvent.change(await screen.findByTestId("api-name"), { target: { value: "new-api" } });
    fireEvent.click(screen.getByTestId("api-save"));

    await waitFor(() =>
      expect(createApi).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-api",
        undefined,
      ),
    );
    await waitFor(() => expect(listApis).toHaveBeenCalledTimes(2));
  });

  it("deletes an API after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("orders を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("apis-delete"));

    const confirm = screen.getByTestId("apis-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("apis-delete-input"), { target: { value: "orders" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteApi).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "a1"),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listApis.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listApis).not.toHaveBeenCalled();
  });
});
