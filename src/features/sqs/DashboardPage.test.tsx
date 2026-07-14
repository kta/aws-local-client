import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const listQueues = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    sqs: {
      listQueues: (...args: unknown[]) => listQueues(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function summary(over: Partial<QueueSummary>): QueueSummary {
  return {
    queueUrl: "http://localhost:4566/000000000000/q",
    name: "q",
    fifo: false,
    approximateMessages: 0,
    approximateNotVisible: 0,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sqs"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/sqs" element={<DashboardPage />} />
          <Route path="/sqs/queues" element={<div>queues page</div>} />
          <Route path="/sqs/queues/:name" element={<div>detail page</div>} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

describe("SQS DashboardPage", () => {
  beforeEach(() => {
    listQueues.mockReset();
  });

  it("renders summary counts from mocked listQueues", async () => {
    listQueues.mockResolvedValue([
      summary({ name: "orders", approximateMessages: 3, approximateNotVisible: 1 }),
      summary({ name: "events.fifo", fifo: true, approximateMessages: 10, approximateNotVisible: 2 }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getAllByTestId("sqs-dash-table")).toHaveLength(2));

    expect(within(screen.getByTestId("sqs-dash-queues")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("sqs-dash-visible")).getByText("13")).toBeInTheDocument();
    expect(within(screen.getByTestId("sqs-dash-inflight")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByTestId("sqs-dash-fifo")).getByText("1")).toBeInTheDocument();
  });

  it("navigates to a queue detail when a row is clicked", async () => {
    listQueues.mockResolvedValue([summary({ name: "orders" })]);

    renderPage();

    const row = await screen.findByTestId("sqs-dash-table");
    fireEvent.click(row);
    expect(await screen.findByText("detail page")).toBeInTheDocument();
  });

  it("routes the create quick action to the queues page with ?create=1", async () => {
    listQueues.mockResolvedValue([]);

    renderPage();

    fireEvent.click(await screen.findByTestId("sqs-dash-create"));
    expect(await screen.findByText("queues page")).toBeInTheDocument();
  });

  it("shows an error banner and refetches on retry", async () => {
    listQueues.mockRejectedValueOnce({ kind: "connection", message: "boom" });

    renderPage();

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();

    listQueues.mockResolvedValueOnce([summary({ name: "orders" })]);
    fireEvent.click(screen.getByTestId("error-retry"));

    await waitFor(() => expect(screen.getByTestId("sqs-dash-table")).toBeInTheDocument());
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});
