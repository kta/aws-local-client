import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { QueueSummary } from "../../api/sqs";
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

const sampleQueues: QueueSummary[] = [
  {
    queueUrl: "http://localhost:4566/000000000000/orders",
    name: "orders",
    fifo: false,
    approximateMessages: 3,
    approximateNotVisible: 1,
  },
  {
    queueUrl: "http://localhost:4566/000000000000/events.fifo",
    name: "events.fifo",
    fifo: true,
    approximateMessages: 0,
    approximateNotVisible: 0,
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    sqs: {
      listQueues: (...args: unknown[]) => listQueues(...args),
      createQueue: (...args: unknown[]) => createQueue(...args),
      deleteQueue: (...args: unknown[]) => deleteQueue(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listQueues = vi.fn();
const createQueue = vi.fn();
const deleteQueue = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { QueuesPage } from "./QueuesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sqs/queues"]}>
      <ConnectionsProvider>
        <QueuesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listQueues.mockReset().mockResolvedValue(sampleQueues);
  createQueue.mockReset().mockResolvedValue(undefined);
  deleteQueue.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QueuesPage", () => {
  it("renders queue rows with name, type and message counts", async () => {
    renderPage();
    expect(await screen.findByTestId("queue-link-orders")).toBeInTheDocument();
    expect(screen.getByTestId("queue-link-events.fifo")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("FIFO")).toBeInTheDocument();
    // Per-row message-count cell (asserted by testid so E2E/unit share the contract).
    expect(screen.getByTestId("queue-msgs-orders")).toHaveTextContent("3");
    expect(screen.getByTestId("queue-msgs-events.fifo")).toHaveTextContent("0");
  });

  it("creates a queue and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("queues-create");

    fireEvent.click(screen.getByTestId("queues-create"));
    fireEvent.change(await screen.findByTestId("q-name"), { target: { value: "new-q" } });
    fireEvent.click(screen.getByTestId("q-save"));

    await waitFor(() =>
      expect(createQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ name: "new-q", fifo: false }),
      ),
    );
    await waitFor(() => expect(listQueues).toHaveBeenCalledTimes(2));
  });

  it("previews the .fifo suffix when FIFO is checked", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("queues-create"));
    fireEvent.change(await screen.findByTestId("q-name"), { target: { value: "events" } });
    fireEvent.click(screen.getByTestId("q-fifo"));
    expect(await screen.findByTestId("q-name-preview")).toHaveTextContent("events.fifo");
  });

  it("deletes a queue after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("orders を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("queues-delete"));

    const confirm = screen.getByTestId("queues-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("queues-delete-input"), { target: { value: "orders" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        sampleQueues[0].queueUrl,
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listQueues.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listQueues).not.toHaveBeenCalled();
  });
});
