import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { DomainSummary } from "../../api/opensearch";

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

const listDomains = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    opensearch: { listDomains: (...a: unknown[]) => listDomains(...a) },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const domain = (name: string, over: Partial<DomainSummary> = {}): DomainSummary => ({
  name,
  engineVersion: "OpenSearch_2.11",
  processing: false,
  created: true,
  ...over,
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/opensearch"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("OpenSearch DashboardPage (R87)", () => {
  beforeEach(() => listDomains.mockReset());
  // Reset before Testing Library's auto-cleanup unmounts: on teardown React
  // re-runs the fetch effect, so a still-rejecting mock would leave a dangling
  // rejection that vitest reports as an unhandled error (see useProfileScopedFetch).
  afterEach(() => listDomains.mockReset());

  it("shows domain / active summary counts", async () => {
    listDomains.mockResolvedValue([
      domain("logs"),
      domain("metrics", { processing: true, created: false }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("opensearch-dash-domains")).toHaveTextContent("2"));
    expect(screen.getByTestId("opensearch-dash-active")).toHaveTextContent("1");
    expect(screen.getByTestId("opensearch-dash-create")).toBeInTheDocument();
  });

  it("shows the opensearch-unsupported banner when describe is unsupported", async () => {
    listDomains.mockRejectedValue(new Error("API for service 'opensearch' not yet implemented"));
    renderPage();

    expect(await screen.findByTestId("opensearch-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("opensearch-dash-create")).not.toBeInTheDocument();
  });
});
