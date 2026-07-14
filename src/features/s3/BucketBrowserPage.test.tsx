import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { ObjectDetail, ObjectPage } from "../../api/s3";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "ministack",
    endpointUrl: "http://localhost:4574",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

const listObjects = vi.fn();
const headObject = vi.fn();
const putObject = vi.fn();
const downloadObject = vi.fn();
const deleteObject = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: async () => profiles,
    s3: {
      listObjects: (...args: unknown[]) => listObjects(...args),
      headObject: (...args: unknown[]) => headObject(...args),
      putObject: (...args: unknown[]) => putObject(...args),
      downloadObject: (...args: unknown[]) => downloadObject(...args),
      deleteObject: (...args: unknown[]) => deleteObject(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...args: unknown[]) => save(...args) }));

const page = (over: Partial<ObjectPage> = {}): ObjectPage => ({
  prefixes: ["photos/"],
  objects: [{ key: "root.txt", size: 4, lastModified: "2026-07-14T00:00:00Z" }],
  nextToken: null,
  ...over,
});

const detail = (): ObjectDetail => ({
  key: "root.txt",
  size: 4,
  contentType: "text/plain",
  etag: '"abc"',
  lastModified: "2026-07-14T00:00:00Z",
  metadata: {},
});

import { ConnectionsProvider } from "../../state/connections";
import { BucketBrowserPage } from "./BucketBrowserPage";

function renderPage(bucket = "mybucket") {
  return render(
    <MemoryRouter initialEntries={[`/s3/buckets/${bucket}`]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/s3/buckets/:bucket" element={<BucketBrowserPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("BucketBrowserPage", () => {
  beforeEach(() => {
    listObjects.mockReset().mockResolvedValue(page());
    headObject.mockReset().mockResolvedValue(detail());
    putObject.mockReset().mockResolvedValue(undefined);
    downloadObject.mockReset().mockResolvedValue(undefined);
    deleteObject.mockReset().mockResolvedValue(undefined);
    save.mockReset();
    delete window.__E2E_SAVE_PATH;
  });

  afterEach(() => {
    delete window.__E2E_SAVE_PATH;
  });

  it("renders prefixes, objects and the root breadcrumb", async () => {
    renderPage();
    expect(await screen.findByTestId("object-row-root.txt")).toBeInTheDocument();
    expect(screen.getByTestId("prefix-link-photos/")).toBeInTheDocument();
    expect(screen.getByTestId("prefix-crumb-0")).toHaveTextContent("mybucket");
  });

  it("navigates into a prefix and refetches with the new prefix", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("prefix-link-photos/"));
    await waitFor(() =>
      expect(listObjects).toHaveBeenCalledWith(profiles[0], "mybucket", "photos/"),
    );
  });

  it("opens the detail panel on object click", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("object-row-root.txt"));
    await waitFor(() =>
      expect(headObject).toHaveBeenCalledWith(profiles[0], "mybucket", "root.txt"),
    );
    expect(await screen.findByTestId("od-content-type")).toHaveTextContent("text/plain");
    expect(screen.getByTestId("od-etag")).toHaveTextContent('"abc"');
  });

  it("uploads a file with the current prefix and content type", async () => {
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("object-upload-input"), { target: { files: [file] } });
    await waitFor(() =>
      expect(putObject).toHaveBeenCalledWith(
        profiles[0],
        "mybucket",
        "hello.txt",
        "aGVsbG8=",
        "text/plain",
      ),
    );
  });

  it("rejects uploads larger than 100MB before hitting the backend", async () => {
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByTestId("object-upload-input"), { target: { files: [big] } });
    expect(await screen.findByTestId("error-banner")).toHaveTextContent(/100MB/);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("downloads via the injected E2E save path", async () => {
    window.__E2E_SAVE_PATH = "/tmp/out.txt";
    renderPage();
    fireEvent.click(await screen.findByTestId("object-row-root.txt"));
    fireEvent.click(await screen.findByTestId("object-download"));
    await waitFor(() =>
      expect(downloadObject).toHaveBeenCalledWith(
        profiles[0],
        "mybucket",
        "root.txt",
        "/tmp/out.txt",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("downloads via the save dialog when no E2E path is set", async () => {
    save.mockResolvedValue("/chosen/root.txt");
    renderPage();
    fireEvent.click(await screen.findByTestId("object-row-root.txt"));
    fireEvent.click(await screen.findByTestId("object-download"));
    await waitFor(() =>
      expect(downloadObject).toHaveBeenCalledWith(
        profiles[0],
        "mybucket",
        "root.txt",
        "/chosen/root.txt",
      ),
    );
  });

  it("does nothing when the save dialog is cancelled", async () => {
    save.mockResolvedValue(null);
    renderPage();
    fireEvent.click(await screen.findByTestId("object-row-root.txt"));
    fireEvent.click(await screen.findByTestId("object-download"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("deletes selected objects after typing the bucket name", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("root.txt を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("objects-delete"));

    const confirm = screen.getByTestId("objects-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("objects-delete-input"), { target: { value: "mybucket" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteObject).toHaveBeenCalledWith(profiles[0], "mybucket", "root.txt"),
    );
  });

  it("loads more when a continuation token is present", async () => {
    listObjects
      .mockReset()
      .mockResolvedValueOnce(page({ nextToken: "tok" }))
      .mockResolvedValueOnce(
        page({
          prefixes: [],
          objects: [{ key: "more.txt", size: 1, lastModified: null }],
          nextToken: null,
        }),
      );
    renderPage();
    fireEvent.click(await screen.findByTestId("objects-more"));
    expect(await screen.findByTestId("object-row-more.txt")).toBeInTheDocument();
    await waitFor(() =>
      expect(listObjects).toHaveBeenLastCalledWith(profiles[0], "mybucket", "", "tok"),
    );
  });
});
