import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { EventBusSummary } from "../../api/eventbridge";
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

const sampleBuses: EventBusSummary[] = [
  { name: "default", arn: "arn:aws:events:ap-northeast-1:000000000000:event-bus/default" },
  { name: "orders-bus", arn: "arn:aws:events:ap-northeast-1:000000000000:event-bus/orders-bus" },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    eventbridge: {
      listBuses: (...args: unknown[]) => listBuses(...args),
      createBus: (...args: unknown[]) => createBus(...args),
      deleteBus: (...args: unknown[]) => deleteBus(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listBuses = vi.fn();
const createBus = vi.fn();
const deleteBus = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { BusesPage } from "./BusesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/eventbridge/buses"]}>
      <ConnectionsProvider>
        <BusesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listBuses.mockReset().mockResolvedValue(sampleBuses);
  createBus.mockReset().mockResolvedValue(undefined);
  deleteBus.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("eventbridge BusesPage", () => {
  it("renders bus rows", async () => {
    renderPage();
    expect(await screen.findByTestId("bus-row-default")).toBeInTheDocument();
    expect(screen.getByTestId("bus-row-orders-bus")).toBeInTheDocument();
  });

  it("creates a bus and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("buses-create");
    fireEvent.click(screen.getByTestId("buses-create"));
    fireEvent.change(await screen.findByTestId("bus-name"), { target: { value: "new-bus" } });
    fireEvent.click(screen.getByTestId("bus-save"));

    await waitFor(() =>
      expect(createBus).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-bus",
      ),
    );
    await waitFor(() => expect(listBuses).toHaveBeenCalledTimes(2));
  });

  it("deletes a non-default bus after typing its name", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("orders-bus を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("buses-delete"));

    const confirm = screen.getByTestId("buses-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("buses-delete-input"), { target: { value: "orders-bus" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteBus).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "orders-bus"),
    );
  });

  it("keeps delete disabled when only the default bus is selected", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("default を選択");
    fireEvent.click(checkbox);
    expect(screen.getByTestId("buses-delete")).toBeDisabled();
  });

  it("shows the error banner when listing fails", async () => {
    listBuses.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the unsupported banner when EventBridge is unavailable", async () => {
    listBuses.mockRejectedValue({ kind: "internal", message: "not supported" });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("eventbridge-unsupported")).toBeInTheDocument(),
    );
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listBuses).not.toHaveBeenCalled();
  });
});
