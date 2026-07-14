import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SnsSubscription, TopicSummary } from "../../api/sns";
import type { QueueDetail, QueueSummary } from "../../api/sqs";
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

const topic: TopicSummary = {
  topicArn: "arn:aws:sns:ap-northeast-1:000000000000:orders",
  name: "orders",
  fifo: false,
};
const fifoTopic: TopicSummary = {
  topicArn: "arn:aws:sns:ap-northeast-1:000000000000:orders.fifo",
  name: "orders.fifo",
  fifo: true,
};
const subscription: SnsSubscription = {
  subscriptionArn: "arn:aws:sns:ap-northeast-1:000000000000:orders:sub-1",
  protocol: "sqs",
  endpoint: "arn:aws:sqs:ap-northeast-1:000000000000:orders-queue",
  filterPolicy: null,
  rawDelivery: false,
};
const queueSummary: QueueSummary = {
  queueUrl: "http://localhost:4566/000000000000/orders-queue",
  name: "orders-queue",
  fifo: false,
  approximateMessages: 0,
  approximateNotVisible: 0,
};
const queueDetail: QueueDetail = {
  ...queueSummary,
  arn: "arn:aws:sqs:ap-northeast-1:000000000000:orders-queue",
  visibilityTimeout: 30,
  retentionPeriod: 345600,
  delaySeconds: 0,
  maxMessageSize: 262144,
  redrivePolicy: null,
  createdAt: null,
};

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    sns: {
      listTopics: (...args: unknown[]) => listTopics(...args),
      listSubscriptions: (...args: unknown[]) => listSubscriptions(...args),
      subscribeSqs: (...args: unknown[]) => subscribeSqs(...args),
      unsubscribe: (...args: unknown[]) => unsubscribe(...args),
      publish: (...args: unknown[]) => publish(...args),
      getTopicAttributes: (...args: unknown[]) => getTopicAttributes(...args),
      setDisplayName: (...args: unknown[]) => setDisplayName(...args),
      listTopicTags: (...args: unknown[]) => listTopicTags(...args),
      tagTopic: (...args: unknown[]) => tagTopic(...args),
      untagTopic: (...args: unknown[]) => untagTopic(...args),
    },
    sqs: {
      listQueues: (...args: unknown[]) => listQueues(...args),
      getQueue: (...args: unknown[]) => getQueue(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listTopics = vi.fn();
const listSubscriptions = vi.fn();
const subscribeSqs = vi.fn();
const unsubscribe = vi.fn();
const publish = vi.fn();
const listQueues = vi.fn();
const getQueue = vi.fn();
const getTopicAttributes = vi.fn();
const setDisplayName = vi.fn();
const listTopicTags = vi.fn();
const tagTopic = vi.fn();
const untagTopic = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { TopicDetailPage } from "./TopicDetailPage";

function renderPage(name = "orders") {
  return render(
    <MemoryRouter initialEntries={[`/sns/topics/${name}`]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/sns/topics/:name" element={<TopicDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listTopics.mockReset().mockResolvedValue([topic, fifoTopic]);
  listSubscriptions.mockReset().mockResolvedValue([subscription]);
  subscribeSqs.mockReset().mockResolvedValue(undefined);
  unsubscribe.mockReset().mockResolvedValue(undefined);
  publish.mockReset().mockResolvedValue("msg-123");
  listQueues.mockReset().mockResolvedValue([queueSummary]);
  getQueue.mockReset().mockResolvedValue(queueDetail);
  getTopicAttributes.mockReset().mockResolvedValue({
    topicArn: topic.topicArn,
    displayName: "Orders",
    owner: "000000000000",
    subscriptionsConfirmed: 2,
    subscriptionsPending: 0,
    fifo: false,
  });
  setDisplayName.mockReset().mockResolvedValue(undefined);
  listTopicTags.mockReset().mockResolvedValue([{ key: "env", value: "prod" }]);
  tagTopic.mockReset().mockResolvedValue(undefined);
  untagTopic.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TopicDetailPage", () => {
  it("resolves the topic by name and shows both tabs", async () => {
    renderPage();
    expect(await screen.findByTestId("tab-subs")).toBeInTheDocument();
    expect(screen.getByTestId("tab-publish")).toBeInTheDocument();
  });

  it("lists subscriptions with a row per endpoint", async () => {
    renderPage();
    expect(await screen.findByTestId("sub-row-orders-queue")).toBeInTheDocument();
  });

  it("adds a subscription resolving the queue ARN as the endpoint", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("sub-add"));

    await screen.findByTestId("sub-queue-select");
    fireEvent.click(screen.getByTestId("sub-save"));

    await waitFor(() =>
      expect(subscribeSqs).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        queueDetail.arn,
        null,
        false,
      ),
    );
  });

  it("removes a subscription after typing the queue name to confirm", async () => {
    renderPage();
    await screen.findByTestId("sub-row-orders-queue");
    fireEvent.click(screen.getByTestId("sub-remove"));

    const confirm = screen.getByTestId("sub-remove-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("sub-remove-input"), {
      target: { value: "orders-queue" },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(unsubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        subscription.subscriptionArn,
      ),
    );
  });

  it("publishes a message and shows the MessageId result", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-publish"));

    fireEvent.change(await screen.findByTestId("pub-message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("pub-save"));

    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        expect.objectContaining({ message: "hello" }),
      ),
    );
    expect(await screen.findByTestId("publish-result")).toHaveTextContent("msg-123");
  });

  it("clears the previous publish result when an input changes", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-publish"));

    fireEvent.change(await screen.findByTestId("pub-message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("pub-save"));
    expect(await screen.findByTestId("publish-result")).toHaveTextContent("msg-123");

    // Editing any field discards the stale "発行しました" message.
    fireEvent.change(screen.getByTestId("pub-message"), { target: { value: "hello world" } });
    await waitFor(() =>
      expect(screen.queryByTestId("publish-result")).not.toBeInTheDocument(),
    );
  });

  it("publishes with message attributes, excluding rows without a name", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-publish"));

    fireEvent.change(await screen.findByTestId("pub-message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("pub-add-attr"));
    fireEvent.change(screen.getByTestId("pub-attr-name-0"), { target: { value: "event" } });
    fireEvent.change(screen.getByTestId("pub-attr-value-0"), {
      target: { value: "order_created" },
    });
    // A second row with an empty name must be dropped from the request.
    fireEvent.click(screen.getByTestId("pub-add-attr"));
    fireEvent.change(screen.getByTestId("pub-attr-value-1"), { target: { value: "ignored" } });
    fireEvent.click(screen.getByTestId("pub-save"));

    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        expect.objectContaining({
          message: "hello",
          attributes: { event: { dataType: "String", stringValue: "order_created" } },
        }),
      ),
    );
  });

  it("shows group-id and dedup-id fields for a FIFO topic", async () => {
    renderPage("orders.fifo");
    fireEvent.click(await screen.findByTestId("tab-publish"));
    expect(await screen.findByTestId("pub-group-id")).toBeInTheDocument();
    expect(screen.getByTestId("pub-dedup-id")).toBeInTheDocument();
  });

  it("shows attributes and saves an edited display name", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-attrs"));

    const input = await screen.findByTestId("attr-display-name");
    await waitFor(() => expect(input).toHaveValue("Orders"));
    expect(screen.getByTestId("attrs-table")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "New Orders" } });
    fireEvent.click(screen.getByTestId("attr-save"));

    await waitFor(() =>
      expect(setDisplayName).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        "New Orders",
      ),
    );
    // Re-fetches attributes after saving.
    await waitFor(() => expect(getTopicAttributes).toHaveBeenCalledTimes(2));
  });

  it("lists tags and adds a new one", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-tags"));

    expect(await screen.findByTestId("tags-table")).toBeInTheDocument();
    expect(screen.getByTestId("tag-remove-env")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tag-add"));
    fireEvent.change(await screen.findByTestId("tag-key-input"), { target: { value: "team" } });
    fireEvent.change(screen.getByTestId("tag-value-input"), { target: { value: "core" } });
    fireEvent.click(screen.getByTestId("tag-save"));

    await waitFor(() =>
      expect(tagTopic).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        "team",
        "core",
      ),
    );
    await waitFor(() => expect(listTopicTags).toHaveBeenCalledTimes(2));
  });

  it("removes a tag", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("tab-tags"));
    fireEvent.click(await screen.findByTestId("tag-remove-env"));

    await waitFor(() =>
      expect(untagTopic).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        topic.topicArn,
        "env",
      ),
    );
  });
});
