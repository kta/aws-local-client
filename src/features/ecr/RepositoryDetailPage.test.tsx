import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { EcrImage } from "../../api/ecr";
import type { ConnectionProfile } from "../../api/types";

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

const listImages = vi.fn();
let listConnectionsImpl = async () => profiles;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: (...args: unknown[]) => listConnectionsImpl(...(args as [])),
    ecr: {
      listImages: (...args: unknown[]) => listImages(...args),
    },
  },
  toAppError: (e: unknown) => ({
    kind: "internal",
    message: e instanceof Error ? e.message : String(e),
  }),
}));

import { ConnectionsProvider } from "../../state/connections";
import { RepositoryDetailPage } from "./RepositoryDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ecr/repositories/alpha"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/ecr/repositories/:name" element={<RepositoryDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("RepositoryDetailPage", () => {
  beforeEach(() => {
    listConnectionsImpl = async () => profiles;
    listImages.mockReset().mockResolvedValue([] as EcrImage[]);
  });

  it("shows the repository name and an empty image table", async () => {
    renderPage();
    expect(await screen.findByTestId("ecr-detail-heading")).toHaveTextContent("alpha");
    expect(await screen.findByTestId("ecr-images-empty")).toBeInTheDocument();
    expect(listImages).toHaveBeenCalledWith(profiles[0], "alpha");
  });

  it("renders image rows when the repository has images", async () => {
    listImages.mockReset().mockResolvedValue([
      { tag: "latest", digest: "sha256:abc", sizeBytes: 2048, pushedAt: "2026-07-22T00:00:00Z" },
    ] as EcrImage[]);
    renderPage();
    expect(await screen.findByText("latest")).toBeInTheDocument();
    expect(screen.getByText("sha256:abc")).toBeInTheDocument();
  });

  it("shows the unsupported banner when the ECR API is unavailable", async () => {
    listImages
      .mockReset()
      .mockRejectedValue(new Error("API for service 'ecr' not yet implemented or pro feature"));
    renderPage();
    expect(await screen.findByTestId("ecr-unsupported")).toBeInTheDocument();
  });
});
