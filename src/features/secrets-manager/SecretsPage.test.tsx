import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SecretSummary } from "../../api/secretsmanager";
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

const sampleSecrets: SecretSummary[] = [
  {
    name: "db/creds",
    arn: "arn:aws:secretsmanager:...:db/creds",
    description: "prod db",
    lastChangedDate: "2026-07-22T00:00:00Z",
  },
  {
    name: "api/token",
    arn: "arn:aws:secretsmanager:...:api/token",
    description: null,
    lastChangedDate: null,
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    secretsManager: {
      list: (...args: unknown[]) => list(...args),
      create: (...args: unknown[]) => create(...args),
      delete: (...args: unknown[]) => remove(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const list = vi.fn();
const create = vi.fn();
const remove = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { SecretsPage } from "./SecretsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/secrets-manager/secrets"]}>
      <ConnectionsProvider>
        <SecretsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  list.mockReset().mockResolvedValue(sampleSecrets);
  create.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SecretsPage", () => {
  it("renders secret rows with name and description", async () => {
    renderPage();
    expect(await screen.findByTestId("secret-link-db/creds")).toBeInTheDocument();
    expect(screen.getByTestId("secret-link-api/token")).toBeInTheDocument();
    expect(screen.getByText("prod db")).toBeInTheDocument();
  });

  it("creates a secret and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("secrets-create");

    fireEvent.click(screen.getByTestId("secrets-create"));
    fireEvent.change(await screen.findByTestId("cs-name"), { target: { value: "new/secret" } });
    fireEvent.change(screen.getByTestId("cs-value"), { target: { value: '{"k":"v"}' } });
    fireEvent.click(screen.getByTestId("cs-save"));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new/secret",
        '{"k":"v"}',
        undefined,
      ),
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("deletes a secret with the recovery-window choice after typing its name", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("db/creds を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("secrets-delete"));

    const confirm = screen.getByTestId("secrets-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("secrets-delete-input"), {
      target: { value: "db/creds" },
    });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "db/creds",
        false,
        30,
      ),
    );
  });

  it("deletes a secret immediately when force is chosen", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("db/creds を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("secrets-delete"));
    fireEvent.click(screen.getByTestId("secrets-delete-mode-force"));
    fireEvent.change(screen.getByTestId("secrets-delete-input"), {
      target: { value: "db/creds" },
    });
    fireEvent.click(screen.getByTestId("secrets-delete-confirm"));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "db/creds",
        true,
        undefined,
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    list.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(list).not.toHaveBeenCalled();
  });
});
