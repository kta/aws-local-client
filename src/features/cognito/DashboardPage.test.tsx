import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../../api/types";
import type { UserPoolDetail, UserPoolSummary } from "../../api/cognito";

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

const listUserPools = vi.fn();
const getUserPool = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cognito: {
      listUserPools: (...args: unknown[]) => listUserPools(...args),
      getUserPool: (...args: unknown[]) => getUserPool(...args),
    },
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

const pool = (id: string, name: string): UserPoolSummary => ({ id, name, createdAt: null });
const detail = (id: string, users: number): UserPoolDetail => ({
  id,
  name: id,
  estimatedUsers: users,
  createdAt: null,
});

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/cognito"]}>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );

describe("Cognito DashboardPage (R60)", () => {
  beforeEach(() => {
    listUserPools.mockReset();
    getUserPool.mockReset();
  });

  it("shows pool and total-user summary counts", async () => {
    listUserPools.mockResolvedValue([pool("p1", "pool-a"), pool("p2", "pool-b")]);
    getUserPool.mockImplementation(async (_p: unknown, id: string) =>
      id === "p1" ? detail("p1", 2) : detail("p2", 3),
    );

    renderPage();

    await waitFor(() => expect(screen.getByTestId("cognito-dash-pools")).toHaveTextContent("2"));
    expect(screen.getByTestId("cognito-dash-users")).toHaveTextContent("5");
  });

  it("shows the cognito-unsupported banner when list is unsupported", async () => {
    listUserPools.mockRejectedValue(new Error("API for service 'cognito-idp' not yet implemented or pro feature"));

    renderPage();

    expect(await screen.findByTestId("cognito-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("cognito-dash-create")).not.toBeInTheDocument();
  });
});
