import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ApiSummary } from "../../api/apigateway";
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

const listApis = vi.fn();
const listApiKeys = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    apigateway: {
      listApis: (...args: unknown[]) => listApis(...args),
      listApiKeys: (...args: unknown[]) => listApiKeys(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const api = (id: string, name: string): ApiSummary => ({
  id,
  name,
  description: null,
  createdDate: null,
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/api-gateway"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("API Gateway DashboardPage (R56)", () => {
  beforeEach(() => {
    listApis.mockReset();
    listApiKeys.mockReset();
  });

  it("shows API and API-key summary counts", async () => {
    listApis.mockResolvedValue([api("a1", "orders"), api("a2", "users")]);
    listApiKeys.mockResolvedValue([{ id: "k1", name: "k", enabled: true, createdDate: null }]);

    renderPage();

    await waitFor(() => expect(screen.getByTestId("apigw-dash-apis")).toHaveTextContent("2"));
    expect(screen.getByTestId("apigw-dash-keys")).toHaveTextContent("1");
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("renders the API-key count as '-' when keys are unsupported", async () => {
    listApis.mockResolvedValue([api("a1", "orders")]);
    listApiKeys.mockRejectedValue(new Error("not supported"));

    renderPage();

    await waitFor(() => expect(screen.getByTestId("apigw-dash-apis")).toHaveTextContent("1"));
    expect(screen.getByTestId("apigw-dash-keys")).toHaveTextContent("-");
  });

  it("shows the error banner when listing APIs fails", async () => {
    listApis.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });
});
