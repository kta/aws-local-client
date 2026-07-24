import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { DomainDetail } from "../../api/opensearch";

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

const getDomain = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    opensearch: { getDomain: (...a: unknown[]) => getDomain(...a) },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

import { ConnectionsProvider } from "../../state/connections";
import { DomainDetailPage } from "./DomainDetailPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/opensearch/domains/logs"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/opensearch/domains/:name" element={<DomainDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("OpenSearch DomainDetailPage (R87)", () => {
  beforeEach(() => getDomain.mockReset());
  // Neutralize the mock before Testing Library unmounts: teardown re-runs the
  // fetch effect, so a rejecting mock would dangle an unhandled rejection.
  afterEach(() => getDomain.mockReset());

  it("renders endpoint, engine version and status", async () => {
    const detail: DomainDetail = {
      name: "logs",
      endpoint: "logs.example:9200",
      engineVersion: "OpenSearch_2.11",
      processing: false,
      created: true,
    };
    getDomain.mockResolvedValue(detail);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("os-detail-endpoint")).toHaveTextContent("logs.example:9200"),
    );
    expect(screen.getByTestId("os-detail-engine")).toHaveTextContent("OpenSearch_2.11");
    expect(screen.getByTestId("os-detail-status")).toHaveTextContent("アクティブ");
    expect(getDomain).toHaveBeenCalledWith(profiles[0], "logs");
  });

  it("surfaces an error banner when the fetch fails", async () => {
    getDomain.mockRejectedValue(new Error("boom"));
    renderPage();

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });
});
