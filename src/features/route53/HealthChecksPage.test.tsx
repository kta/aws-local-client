import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { HealthCheckSummary } from "../../api/route53";
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

const sampleChecks: HealthCheckSummary[] = [
  { id: "hc-1", target: "127.0.0.1", port: 80, checkType: "TCP", resourcePath: null },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    route53: {
      listHealthChecks: (...a: unknown[]) => listHealthChecks(...a),
      createHealthCheck: (...a: unknown[]) => createHealthCheck(...a),
      deleteHealthCheck: (...a: unknown[]) => deleteHealthCheck(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listHealthChecks = vi.fn();
const createHealthCheck = vi.fn();
const deleteHealthCheck = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { HealthChecksPage } from "./HealthChecksPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/route53/health-checks"]}>
      <ConnectionsProvider>
        <HealthChecksPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listHealthChecks.mockReset().mockResolvedValue(sampleChecks);
  createHealthCheck.mockReset().mockResolvedValue(undefined);
  deleteHealthCheck.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("HealthChecksPage", () => {
  it("renders health check rows", async () => {
    renderPage();
    expect(await screen.findByTestId("hc-target-hc-1")).toHaveTextContent("127.0.0.1");
    expect(screen.getByText("TCP")).toBeInTheDocument();
  });

  it("creates a health check", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("healthcheck-create"));
    fireEvent.change(screen.getByTestId("hc-target"), { target: { value: "example.com" } });
    fireEvent.click(screen.getByTestId("hc-save"));
    await waitFor(() =>
      expect(createHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ target: "example.com", checkType: "HTTP", port: 80 }),
      ),
    );
  });

  it("deletes a health check after confirming", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("healthcheck-delete-hc-1"));
    fireEvent.click(screen.getByTestId("healthcheck-delete-confirm"));
    await waitFor(() =>
      expect(deleteHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "hc-1",
      ),
    );
  });

  it("shows the unsupported banner on a 404 / not-found load failure", async () => {
    listHealthChecks.mockRejectedValue({ kind: "internal", message: "404 page not found" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("route53-unsupported")).toBeInTheDocument());
    expect(screen.queryByTestId("healthcheck-create")).not.toBeInTheDocument();
  });
});
