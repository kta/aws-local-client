import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { QueueDetail, QueueSummary, SqsMessage } from "../../api/sqs";
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

const url = "http://localhost:4566/000000000000/orders";
const summary: QueueSummary = {
  queueUrl: url,
  name: "orders",
  fifo: false,
  approximateMessages: 1,
  approximateNotVisible: 0,
};
const detail: QueueDetail = {
  ...summary,
  arn: "arn:aws:sqs:ap-northeast-1:000000000000:orders",
  visibilityTimeout: 30,
  retentionPeriod: 345600,
  delaySeconds: 0,
  maxMessageSize: 262144,
  redrivePolicy: null,
  createdAt: "2026-07-14T10:00:00Z",
};
const message: SqsMessage = {
  messageId: "m1",
  receiptHandle: "rh1",
  body: "hello world",
  attributes: {},
  sentAt: "2026-07-14T10:05:00Z",
};

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    sqs: {
      listQueues: (...args: unknown[]) => listQueues(...args),
      getQueue: (...args: unknown[]) => getQueue(...args),
      receiveMessages: (...args: unknown[]) => receiveMessages(...args),
      deleteMessage: (...args: unknown[]) => deleteMessage(...args),
      sendMessage: (...args: unknown[]) => sendMessage(...args),
      purgeQueue: (...args: unknown[]) => purgeQueue(...args),
      setQueueAttributes: (...args: unknown[]) => setQueueAttributes(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listQueues = vi.fn();
const getQueue = vi.fn();
const receiveMessages = vi.fn();
const deleteMessage = vi.fn();
const sendMessage = vi.fn();
const purgeQueue = vi.fn();
const setQueueAttributes = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { QueueDetailPage } from "./QueueDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sqs/queues/orders"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/sqs/queues/:name" element={<QueueDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listQueues.mockReset().mockResolvedValue([summary]);
  getQueue.mockReset().mockResolvedValue(detail);
  receiveMessages.mockReset().mockResolvedValue([message]);
  deleteMessage.mockReset().mockResolvedValue(undefined);
  sendMessage.mockReset().mockResolvedValue(undefined);
  purgeQueue.mockReset().mockResolvedValue(undefined);
  setQueueAttributes.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QueueDetailPage", () => {
  it("resolves the queue by name and shows the messages tab", async () => {
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), url));
    expect(screen.getByTestId("tab-messages")).toBeInTheDocument();
    expect(screen.getByTestId("tab-settings")).toBeInTheDocument();
  });

  it("polls for messages and expands the row to show the full body", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("queue-poll")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("queue-poll"));

    const row = await screen.findByTestId("msg-row-m1");
    expect(row).toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByTestId("msg-body-m1")).toHaveTextContent("hello world");
  });

  it("deletes the selected message via its receipt handle", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("queue-poll")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("queue-poll"));
    await screen.findByTestId("msg-row-m1");

    fireEvent.click(screen.getByLabelText("m1 を選択"));
    fireEvent.click(screen.getByTestId("msg-delete"));

    await waitFor(() =>
      expect(deleteMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), url, "rh1"),
    );
    await waitFor(() => expect(screen.queryByTestId("msg-row-m1")).not.toBeInTheDocument());
  });

  it("sends a message from the modal", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("queue-send")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("queue-send"));
    fireEvent.change(await screen.findByTestId("sm-body"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("sm-save"));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        url,
        expect.objectContaining({ body: "hi" }),
      ),
    );
  });

  it("purges the queue after typing its name", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("queue-purge"));

    const confirm = screen.getByTestId("queue-purge-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("queue-purge-input"), { target: { value: "orders" } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(purgeQueue).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), url),
    );
  });

  it("saves edited attributes from the settings tab", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-settings"));

    const visibility = await screen.findByTestId("qs-visibility");
    fireEvent.change(visibility, { target: { value: "45" } });
    fireEvent.click(screen.getByTestId("qs-save"));

    await waitFor(() =>
      expect(setQueueAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        url,
        expect.objectContaining({ visibilityTimeout: 45 }),
      ),
    );
  });
});
