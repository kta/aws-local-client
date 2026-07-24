import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SecretDetail, SecretValue, SecretVersion } from "../../api/secretsmanager";
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

const detail: SecretDetail = {
  name: "db/creds",
  arn: "arn:aws:secretsmanager:...:db/creds",
  description: "prod db",
  createdDate: "2026-07-01T00:00:00Z",
  lastChangedDate: "2026-07-22T00:00:00Z",
  tags: [{ key: "env", value: "prod" }],
};

const value: SecretValue = {
  secretString: '{"password":"s3cret"}',
  versionId: "v-current",
  createdDate: "2026-07-22T00:00:00Z",
};

const versions: SecretVersion[] = [
  { versionId: "v-current", stages: ["AWSCURRENT"], createdDate: null },
  { versionId: "v-prev", stages: ["AWSPREVIOUS"], createdDate: null },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    secretsManager: {
      describe: (...args: unknown[]) => describe_(...args),
      getValue: (...args: unknown[]) => getValue(...args),
      listVersions: (...args: unknown[]) => listVersions(...args),
      putValue: (...args: unknown[]) => putValue(...args),
      tag: (...args: unknown[]) => tag(...args),
      untag: (...args: unknown[]) => untag(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const describe_ = vi.fn();
const getValue = vi.fn();
const listVersions = vi.fn();
const putValue = vi.fn();
const tag = vi.fn();
const untag = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { SecretDetailPage } from "./SecretDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/secrets-manager/secrets/db%2Fcreds"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/secrets-manager/secrets/:name" element={<SecretDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  describe_.mockReset().mockResolvedValue(detail);
  getValue.mockReset().mockResolvedValue(value);
  listVersions.mockReset().mockResolvedValue(versions);
  putValue.mockReset().mockResolvedValue(undefined);
  tag.mockReset().mockResolvedValue(undefined);
  untag.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SecretDetailPage", () => {
  it("masks the value by default and reveals it on toggle", async () => {
    renderPage();
    const el = await screen.findByTestId("secret-value");
    expect(el).toHaveTextContent("●●●●●●●●");
    expect(el).not.toHaveTextContent("s3cret");

    fireEvent.click(screen.getByTestId("secret-value-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("secret-value")).toHaveTextContent('{"password":"s3cret"}'),
    );
  });

  it("lists versions with their staging labels", async () => {
    renderPage();
    expect(await screen.findByTestId("version-row-v-current")).toHaveTextContent("AWSCURRENT");
    expect(screen.getByTestId("version-row-v-prev")).toHaveTextContent("AWSPREVIOUS");
  });

  it("saves a new version via the put modal and refreshes the versions table", async () => {
    // First load shows one version; after the put the table refetches and shows two.
    listVersions
      .mockReset()
      .mockResolvedValueOnce([versions[0]])
      .mockResolvedValue(versions);
    renderPage();
    expect(await screen.findByTestId("version-row-v-current")).toBeInTheDocument();
    expect(screen.queryByTestId("version-row-v-prev")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("secret-put"));
    fireEvent.change(await screen.findByTestId("sv-value"), {
      target: { value: '{"password":"next"}' },
    });
    fireEvent.click(screen.getByTestId("sv-save"));
    await waitFor(() =>
      expect(putValue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "db/creds",
        '{"password":"next"}',
      ),
    );
    // The versions table refetched and now lists the second version.
    expect(await screen.findByTestId("version-row-v-prev")).toBeInTheDocument();
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it("lists an existing tag and adds a new one", async () => {
    renderPage();
    expect(await screen.findByTestId("tag-remove-env")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tag-add"));
    fireEvent.change(await screen.findByTestId("tag-key-input"), { target: { value: "team" } });
    fireEvent.change(screen.getByTestId("tag-value-input"), { target: { value: "core" } });
    fireEvent.click(screen.getByTestId("tag-save"));
    await waitFor(() =>
      expect(tag).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "db/creds",
        "team",
        "core",
      ),
    );
  });

  it("removes a tag", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tag-remove-env"));
    await waitFor(() =>
      expect(untag).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "db/creds", "env"),
    );
  });
});
