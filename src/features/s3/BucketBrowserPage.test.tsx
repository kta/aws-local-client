import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { BucketProperties, ObjectDetail, ObjectPage, ObjectVersion } from "../../api/s3";

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
const downloadObject = vi.fn();
const deleteObject = vi.fn();
const uploadFile = vi.fn();
const copyObject = vi.fn();
const createFolder = vi.fn();
const getBucketProperties = vi.fn();
const setVersioning = vi.fn();
const putBucketTagging = vi.fn();
const putBucketCors = vi.fn();
const putBucketPolicy = vi.fn();
const listObjectVersions = vi.fn();
const downloadObjectVersion = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: async () => profiles,
    s3: {
      listObjects: (...args: unknown[]) => listObjects(...args),
      headObject: (...args: unknown[]) => headObject(...args),
      downloadObject: (...args: unknown[]) => downloadObject(...args),
      deleteObject: (...args: unknown[]) => deleteObject(...args),
      uploadFile: (...args: unknown[]) => uploadFile(...args),
      copyObject: (...args: unknown[]) => copyObject(...args),
      createFolder: (...args: unknown[]) => createFolder(...args),
      getBucketProperties: (...args: unknown[]) => getBucketProperties(...args),
      setVersioning: (...args: unknown[]) => setVersioning(...args),
      putBucketTagging: (...args: unknown[]) => putBucketTagging(...args),
      putBucketCors: (...args: unknown[]) => putBucketCors(...args),
      putBucketPolicy: (...args: unknown[]) => putBucketPolicy(...args),
      listObjectVersions: (...args: unknown[]) => listObjectVersions(...args),
      downloadObjectVersion: (...args: unknown[]) => downloadObjectVersion(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const save = vi.fn();
const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
  open: (...args: unknown[]) => open(...args),
}));

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

const props = (over: Partial<BucketProperties> = {}): BucketProperties => ({
  versioning: "Enabled",
  tags: [{ key: "env", value: "dev" }],
  corsJson: null,
  policyJson: null,
  ...over,
});

const versions = (): ObjectVersion[] => [
  {
    key: "root.txt",
    versionId: "v2",
    isLatest: true,
    deleteMarker: false,
    size: 4,
    lastModified: "2026-07-14T00:00:00Z",
  },
  {
    key: "root.txt",
    versionId: "v1",
    isLatest: false,
    deleteMarker: false,
    size: 3,
    lastModified: "2026-07-13T00:00:00Z",
  },
];

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
    downloadObject.mockReset().mockResolvedValue(undefined);
    deleteObject.mockReset().mockResolvedValue(undefined);
    uploadFile.mockReset().mockResolvedValue(undefined);
    copyObject.mockReset().mockResolvedValue(undefined);
    createFolder.mockReset().mockResolvedValue(undefined);
    getBucketProperties.mockReset().mockResolvedValue(props());
    setVersioning.mockReset().mockResolvedValue(undefined);
    putBucketTagging.mockReset().mockResolvedValue(undefined);
    putBucketCors.mockReset().mockResolvedValue(undefined);
    putBucketPolicy.mockReset().mockResolvedValue(undefined);
    listObjectVersions.mockReset().mockResolvedValue(versions());
    downloadObjectVersion.mockReset().mockResolvedValue(undefined);
    save.mockReset();
    open.mockReset();
    delete window.__E2E_SAVE_PATH;
    delete window.__E2E_UPLOAD_PATH;
  });

  afterEach(() => {
    delete window.__E2E_SAVE_PATH;
    delete window.__E2E_UPLOAD_PATH;
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

  it("uploads a file chosen via the dialog with the current prefix", async () => {
    open.mockResolvedValue("/home/user/hello.txt");
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("object-upload"));
    await waitFor(() =>
      expect(uploadFile).toHaveBeenCalledWith(
        profiles[0],
        "mybucket",
        "hello.txt",
        "/home/user/hello.txt",
      ),
    );
  });

  it("uploads via the injected E2E upload path without opening the dialog", async () => {
    window.__E2E_UPLOAD_PATH = "/seam/pic.png";
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("object-upload"));
    await waitFor(() =>
      expect(uploadFile).toHaveBeenCalledWith(profiles[0], "mybucket", "pic.png", "/seam/pic.png"),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("does not upload when the file dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("object-upload"));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(uploadFile).not.toHaveBeenCalled();
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

  it("copies a single selected object to a new key", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("root.txt を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("object-copy"));
    fireEvent.change(screen.getByTestId("copy-dest-input"), { target: { value: "copy.txt" } });
    fireEvent.click(screen.getByTestId("copy-save"));
    await waitFor(() =>
      expect(copyObject).toHaveBeenCalledWith(profiles[0], "mybucket", "root.txt", "copy.txt"),
    );
  });

  it("creates a folder under the current prefix", async () => {
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("folder-create"));
    fireEvent.change(screen.getByTestId("folder-name-input"), { target: { value: "newdir" } });
    fireEvent.click(screen.getByTestId("folder-save"));
    await waitFor(() =>
      expect(createFolder).toHaveBeenCalledWith(profiles[0], "mybucket", "newdir"),
    );
  });

  it("toggles the versions view and lists versions", async () => {
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("versions-toggle"));
    expect(await screen.findByTestId("versions-table")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-v1")).toBeInTheDocument();
    await waitFor(() =>
      expect(listObjectVersions).toHaveBeenCalledWith(profiles[0], "mybucket", ""),
    );
  });

  it("downloads a specific version via the injected save path", async () => {
    window.__E2E_SAVE_PATH = "/tmp/v1.txt";
    renderPage();
    await screen.findByTestId("object-row-root.txt");
    fireEvent.click(screen.getByTestId("versions-toggle"));
    fireEvent.click(await screen.findByTestId("version-download-v1"));
    await waitFor(() =>
      expect(downloadObjectVersion).toHaveBeenCalledWith(
        profiles[0],
        "mybucket",
        "root.txt",
        "v1",
        "/tmp/v1.txt",
      ),
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

  describe("properties tab", () => {
    it("shows versioning status and toggles it", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("tab-props"));
      expect(await screen.findByTestId("props-versioning-status")).toHaveTextContent("Enabled");
      fireEvent.click(screen.getByTestId("props-versioning-toggle"));
      await waitFor(() =>
        expect(setVersioning).toHaveBeenCalledWith(profiles[0], "mybucket", false),
      );
    });

    it("adds and saves a tag", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("tab-props"));
      await screen.findByTestId("props-tags-table");
      fireEvent.change(screen.getByTestId("props-tag-key"), { target: { value: "team" } });
      fireEvent.change(screen.getByTestId("props-tag-value"), { target: { value: "core" } });
      fireEvent.click(screen.getByTestId("props-tag-add"));
      fireEvent.click(screen.getByTestId("props-tag-save"));
      await waitFor(() =>
        expect(putBucketTagging).toHaveBeenCalledWith(profiles[0], "mybucket", [
          { key: "env", value: "dev" },
          { key: "team", value: "core" },
        ]),
      );
    });

    it("removes a tag before saving", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("tab-props"));
      fireEvent.click(await screen.findByTestId("props-tag-remove-env"));
      fireEvent.click(screen.getByTestId("props-tag-save"));
      await waitFor(() =>
        expect(putBucketTagging).toHaveBeenCalledWith(profiles[0], "mybucket", []),
      );
    });

    it("saves CORS JSON", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("tab-props"));
      const editor = await screen.findByTestId("props-cors-editor");
      fireEvent.change(editor, { target: { value: "[]" } });
      fireEvent.click(screen.getByTestId("props-cors-save"));
      await waitFor(() =>
        expect(putBucketCors).toHaveBeenCalledWith(profiles[0], "mybucket", "[]"),
      );
    });

    it("saves the bucket policy JSON", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("tab-props"));
      const editor = await screen.findByTestId("props-policy-editor");
      fireEvent.change(editor, { target: { value: "{}" } });
      fireEvent.click(screen.getByTestId("props-policy-save"));
      await waitFor(() =>
        expect(putBucketPolicy).toHaveBeenCalledWith(profiles[0], "mybucket", "{}"),
      );
    });
  });
});
