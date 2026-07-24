import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { RepositorySummary } from "../../api/ecr";
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

const listRepositories = vi.fn();
const createRepository = vi.fn();
const deleteRepository = vi.fn();
let listConnectionsImpl = async () => profiles;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: (...args: unknown[]) => listConnectionsImpl(...(args as [])),
    ecr: {
      listRepositories: (...args: unknown[]) => listRepositories(...args),
      createRepository: (...args: unknown[]) => createRepository(...args),
      deleteRepository: (...args: unknown[]) => deleteRepository(...args),
    },
  },
  toAppError: (e: unknown) => ({
    kind: "internal",
    message: e instanceof Error ? e.message : String(e),
  }),
}));

const repo = (name: string): RepositorySummary => ({
  name,
  uri: `000000000000.dkr.ecr.ap-northeast-1.amazonaws.com/${name}`,
  arn: `arn:aws:ecr:ap-northeast-1:000000000000:repository/${name}`,
  createdAt: "2026-07-22T00:00:00Z",
});

import { ConnectionsProvider } from "../../state/connections";
import { RepositoriesPage } from "./RepositoriesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ecr/repositories"]}>
      <ConnectionsProvider>
        <RepositoriesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("RepositoriesPage", () => {
  beforeEach(() => {
    listConnectionsImpl = async () => profiles;
    listRepositories.mockReset().mockResolvedValue([repo("alpha"), repo("beta")]);
    createRepository.mockReset().mockResolvedValue(undefined);
    deleteRepository.mockReset().mockResolvedValue(undefined);
  });

  it("renders the repository list and count", async () => {
    renderPage();
    expect(await screen.findByTestId("ecr-row-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("ecr-row-beta")).toBeInTheDocument();
    expect(screen.getByTestId("ecr-repositories-count")).toHaveTextContent("(2)");
  });

  it("creates a repository via the modal", async () => {
    renderPage();
    await screen.findByTestId("ecr-row-alpha");
    fireEvent.click(screen.getByTestId("ecr-create"));
    fireEvent.change(screen.getByTestId("ecr-name"), { target: { value: "gamma" } });
    fireEvent.click(screen.getByTestId("ecr-save"));
    await waitFor(() => expect(createRepository).toHaveBeenCalledWith(profiles[0], "gamma"));
  });

  it("deletes a repository with the name-typed confirm and force option", async () => {
    renderPage();
    await screen.findByTestId("ecr-row-alpha");
    fireEvent.click(screen.getAllByTestId("ecr-delete")[0]);

    const confirm = screen.getByTestId("ecr-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("ecr-delete-input"), { target: { value: "alpha" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("ecr-delete-force"));
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith(profiles[0], "alpha", true));
  });

  it("shows an error banner when a create is rejected", async () => {
    createRepository.mockReset().mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByTestId("ecr-row-alpha");
    fireEvent.click(screen.getByTestId("ecr-create"));
    fireEvent.change(screen.getByTestId("ecr-name"), { target: { value: "gamma" } });
    fireEvent.click(screen.getByTestId("ecr-save"));
    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });

  it("shows the unsupported banner and hides the create action", async () => {
    listRepositories
      .mockReset()
      .mockRejectedValue(new Error("API for service 'ecr' not yet implemented or pro feature"));
    renderPage();
    expect(await screen.findByTestId("ecr-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("ecr-create")).not.toBeInTheDocument();
  });

  it("prompts to connect when no profile is active", async () => {
    listConnectionsImpl = async () => [];
    renderPage();
    expect(await screen.findByText(/接続が未登録です/)).toBeInTheDocument();
    expect(listRepositories).not.toHaveBeenCalled();
  });
});
