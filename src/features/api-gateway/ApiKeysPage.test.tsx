import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ApiKeySummary } from "../../api/apigateway";
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

const sampleKeys: ApiKeySummary[] = [
  { id: "k1", name: "prod-key", enabled: true, createdDate: null },
];

const listApiKeys = vi.fn();
const createApiKey = vi.fn();
const deleteApiKey = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    apigateway: {
      listApiKeys: (...args: unknown[]) => listApiKeys(...args),
      createApiKey: (...args: unknown[]) => createApiKey(...args),
      deleteApiKey: (...args: unknown[]) => deleteApiKey(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { ConnectionsProvider } from "../../state/connections";
import { ApiKeysPage } from "./ApiKeysPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/api-gateway/api-keys"]}>
      <ConnectionsProvider>
        <ApiKeysPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  listApiKeys.mockReset().mockResolvedValue(sampleKeys);
  createApiKey.mockReset().mockResolvedValue(sampleKeys[0]);
  deleteApiKey.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("ApiKeysPage (R59)", () => {
  it("renders API key rows", async () => {
    renderPage();
    expect(await screen.findByTestId("apikey-name-k1")).toHaveTextContent("prod-key");
  });

  it("creates an API key and reloads the list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("api-keys-create"));
    fireEvent.change(await screen.findByTestId("key-name"), { target: { value: "new-key" } });
    fireEvent.click(screen.getByTestId("key-save"));

    await waitFor(() =>
      expect(createApiKey).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "new-key"),
    );
    await waitFor(() => expect(listApiKeys).toHaveBeenCalledTimes(2));
  });

  it("deletes an API key after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("prod-key を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("api-keys-delete"));

    const confirm = screen.getByTestId("api-keys-delete-confirm");
    fireEvent.change(screen.getByTestId("api-keys-delete-input"), { target: { value: "prod-key" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteApiKey).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "k1"),
    );
  });

  it("shows the unsupported banner when the emulator has no API-key support", async () => {
    listApiKeys.mockRejectedValue({ kind: "not_found", message: "NoSuchBucket" });
    // (mockReset in beforeEach resets to resolved; override here)
    listApiKeys.mockReset().mockRejectedValue({ kind: "not_found", message: "NoSuchBucket" });

    renderPage();

    expect(await screen.findByTestId("api-gateway-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("api-keys-create")).not.toBeInTheDocument();
  });
});
