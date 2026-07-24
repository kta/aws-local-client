import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { HostedZoneSummary } from "../../api/route53";
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

const sampleZones: HostedZoneSummary[] = [
  { id: "/hostedzone/Z1", name: "example.com.", recordCount: 4, privateZone: false },
  { id: "/hostedzone/Z2", name: "internal.test.", recordCount: 2, privateZone: true },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    route53: {
      listHostedZones: (...args: unknown[]) => listHostedZones(...args),
      createHostedZone: (...args: unknown[]) => createHostedZone(...args),
      deleteHostedZone: (...args: unknown[]) => deleteHostedZone(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listHostedZones = vi.fn();
const createHostedZone = vi.fn();
const deleteHostedZone = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { HostedZonesPage } from "./HostedZonesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/route53/hosted-zones"]}>
      <ConnectionsProvider>
        <HostedZonesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listHostedZones.mockReset().mockResolvedValue(sampleZones);
  createHostedZone.mockReset().mockResolvedValue(undefined);
  deleteHostedZone.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("HostedZonesPage", () => {
  it("renders zone rows with name, type and record count", async () => {
    renderPage();
    expect(await screen.findByTestId("zone-link-example.com.")).toBeInTheDocument();
    expect(screen.getByTestId("zone-records-example.com.")).toHaveTextContent("4");
    expect(screen.getByText("パブリック")).toBeInTheDocument();
    expect(screen.getByText("プライベート")).toBeInTheDocument();
  });

  it("creates a hosted zone and reloads", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("zones-create"));
    fireEvent.change(await screen.findByTestId("zone-name"), { target: { value: "new.example.com" } });
    fireEvent.click(screen.getByTestId("zone-save"));
    await waitFor(() =>
      expect(createHostedZone).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new.example.com",
      ),
    );
    await waitFor(() => expect(listHostedZones).toHaveBeenCalledTimes(2));
  });

  it("deletes a zone after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("example.com. を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("zones-delete"));

    const confirm = screen.getByTestId("zones-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("zones-delete-input"), {
      target: { value: "example.com." },
    });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteHostedZone).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/hostedzone/Z1",
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listHostedZones.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listHostedZones).not.toHaveBeenCalled();
  });
});
