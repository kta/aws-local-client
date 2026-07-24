import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const createDomain = vi.fn();
const deleteDomain = vi.fn();

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    opensearch: {
      listDomains: (...a: unknown[]) => listDomains(...a),
      createDomain: (...a: unknown[]) => createDomain(...a),
      deleteDomain: (...a: unknown[]) => deleteDomain(...a),
    },
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
import { DomainsPage } from "./DomainsPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/opensearch/domains"]}>
      <ConnectionsProvider>
        <DomainsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("OpenSearch DomainsPage (R87/R88)", () => {
  beforeEach(() => {
    noProfiles = false;
    listDomains.mockReset();
    createDomain.mockReset();
    deleteDomain.mockReset();
  });
  // Reset before Testing Library's auto-cleanup unmounts: teardown re-runs the
  // fetch effect, so a rejecting mock would leave a dangling unhandled rejection.
  afterEach(() => {
    listDomains.mockReset();
    createDomain.mockReset();
    deleteDomain.mockReset();
  });

  it("lists domains with name/version/status", async () => {
    listDomains.mockResolvedValue([domain("logs"), domain("metrics", { processing: true, created: false })]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("opensearch-row-logs")).toBeInTheDocument());
    expect(screen.getByTestId("opensearch-row-metrics")).toBeInTheDocument();
    expect(screen.getAllByText("OpenSearch_2.11").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("処理中")).toBeInTheDocument();
  });

  it("creates a domain via the modal", async () => {
    listDomains.mockResolvedValue([]);
    createDomain.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("opensearch-empty")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("opensearch-create"));
    fireEvent.change(screen.getByTestId("os-name"), { target: { value: "new-domain" } });
    fireEvent.click(screen.getByTestId("os-save"));

    await waitFor(() => expect(createDomain).toHaveBeenCalledWith(profiles[0], "new-domain"));
  });

  it("confirms deletion by domain name", async () => {
    listDomains.mockResolvedValue([domain("logs")]);
    deleteDomain.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("opensearch-row-logs")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("opensearch-delete"));
    fireEvent.change(screen.getByTestId("opensearch-delete-input"), { target: { value: "logs" } });
    fireEvent.click(screen.getByTestId("opensearch-delete-confirm"));

    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith(profiles[0], "logs"));
  });

  it("shows the opensearch-unsupported banner and hides create when describe is unsupported", async () => {
    listDomains.mockRejectedValue(new Error("API for service 'opensearch' not yet implemented"));
    renderPage();

    expect(await screen.findByTestId("opensearch-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("opensearch-create")).not.toBeInTheDocument();
  });

  it("R88 middle case: list renders but a rejected create surfaces an error banner", async () => {
    listDomains.mockResolvedValue([]);
    createDomain.mockRejectedValue(new Error("docker socket not available"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("opensearch-create")).toBeInTheDocument());
    // No unsupported takeover on this describe-capable emulator.
    expect(screen.queryByTestId("opensearch-unsupported")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("opensearch-create"));
    fireEvent.change(screen.getByTestId("os-name"), { target: { value: "boom" } });
    fireEvent.click(screen.getByTestId("os-save"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });

  it("shows the connection-required guard when no connection is active", async () => {
    noProfiles = true;
    listDomains.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(screen.queryByTestId("opensearch-domains-heading")).not.toBeInTheDocument();
    expect(listDomains).not.toHaveBeenCalled();
  });
});
