import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../api/types";

const profiles: ConnectionProfile[] = [
  { id: "1", name: "localstack", endpointUrl: "http://localhost:4566", region: "ap-northeast-1", accessKeyId: "dummy", secretAccessKey: "dummy" },
  { id: "2", name: "ministack", endpointUrl: "http://localhost:8000", region: "ap-northeast-1", accessKeyId: "dummy", secretAccessKey: "dummy" },
];

vi.mock("../api/client", () => ({
  api: { listConnections: vi.fn(async () => profiles) },
  toAppError: (e: unknown) => ({ kind: "internal", message: String(e) }),
}));

import { ConnectionsProvider, useConnections } from "./connections";

function Probe() {
  const { active, setActiveId } = useConnections();
  return (
    <div>
      <span data-testid="active">{active?.name ?? "none"}</span>
      <button onClick={() => setActiveId("2")}>switch</button>
    </div>
  );
}

describe("ConnectionsProvider", () => {
  it("defaults active to first profile and can switch", async () => {
    render(
      <ConnectionsProvider>
        <Probe />
      </ConnectionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("localstack"));
    act(() => screen.getByText("switch").click());
    expect(screen.getByTestId("active").textContent).toBe("ministack");
    expect(localStorage.getItem("nlsd.activeConnectionId")).toBe("2");
  });
});
