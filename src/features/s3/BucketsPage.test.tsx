import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { BucketSummary } from "../../api/s3";

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

const listBuckets = vi.fn();
const createBucket = vi.fn();
const deleteBucket = vi.fn();
let listConnectionsImpl = async () => profiles;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: (...args: unknown[]) => listConnectionsImpl(...(args as [])),
    s3: {
      listBuckets: (...args: unknown[]) => listBuckets(...args),
      createBucket: (...args: unknown[]) => createBucket(...args),
      deleteBucket: (...args: unknown[]) => deleteBucket(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const bucket = (name: string): BucketSummary => ({ name, createdAt: "2026-07-14T00:00:00Z" });

import { ConnectionsProvider } from "../../state/connections";
import { BucketsPage } from "./BucketsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/s3/buckets"]}>
      <ConnectionsProvider>
        <BucketsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("BucketsPage", () => {
  beforeEach(() => {
    listConnectionsImpl = async () => profiles;
    listBuckets.mockReset().mockResolvedValue([bucket("alpha"), bucket("beta")]);
    createBucket.mockReset().mockResolvedValue(undefined);
    deleteBucket.mockReset().mockResolvedValue(undefined);
  });

  it("renders the bucket list and count", async () => {
    renderPage();
    expect(await screen.findByTestId("bucket-link-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-link-beta")).toBeInTheDocument();
    expect(screen.getByTestId("buckets-count")).toHaveTextContent("(2)");
  });

  it("creates a bucket via the modal", async () => {
    renderPage();
    await screen.findByTestId("bucket-link-alpha");
    fireEvent.click(screen.getByTestId("buckets-create"));
    fireEvent.change(screen.getByTestId("b-name"), { target: { value: "gamma" } });
    fireEvent.click(screen.getByTestId("b-save"));
    await waitFor(() => expect(createBucket).toHaveBeenCalledWith(profiles[0], "gamma"));
  });

  it("deletes a bucket via the name-typed confirm modal", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("alpha を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("buckets-delete"));

    const confirm = screen.getByTestId("buckets-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("buckets-delete-input"), { target: { value: "alpha" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteBucket).toHaveBeenCalledWith(profiles[0], "alpha"));
  });

  it("shows an error banner when listing fails", async () => {
    listBuckets.mockReset().mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });

  it("prompts to connect when no profile is active", async () => {
    listConnectionsImpl = async () => [];
    renderPage();
    expect(await screen.findByText(/接続が未登録です/)).toBeInTheDocument();
    expect(listBuckets).not.toHaveBeenCalled();
  });
});
