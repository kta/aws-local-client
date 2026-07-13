import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../api/types";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "localstack",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

vi.mock("../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    saveConnection: vi.fn(async () => profiles),
  },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

import { api } from "../api/client";
import { ConnectionsProvider } from "../state/connections";
import { Layout } from "./Layout";

describe("Layout region selector", () => {
  it("persists a region change via api.saveConnection", async () => {
    render(
      <MemoryRouter>
        <ConnectionsProvider>
          <Layout />
        </ConnectionsProvider>
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText<HTMLSelectElement>("リージョンを変更");
    await waitFor(() => expect(select.value).toBe("ap-northeast-1"));

    fireEvent.change(select, { target: { value: "us-east-1" } });

    await waitFor(() =>
      expect(api.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", region: "us-east-1" }),
      ),
    );
  });
});
