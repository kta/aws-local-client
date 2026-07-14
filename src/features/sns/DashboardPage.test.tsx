import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { GlobalSubscription, TopicSummary } from "../../api/sns";
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

const topics: TopicSummary[] = [
  { topicArn: "arn:aws:sns:...:orders", name: "orders", fifo: false },
  { topicArn: "arn:aws:sns:...:events.fifo", name: "events.fifo", fifo: true },
];
const subs: GlobalSubscription[] = [
  {
    subscriptionArn: "arn:aws:sns:...:orders:s1",
    topicArn: "arn:aws:sns:...:orders",
    topicName: "orders",
    protocol: "sqs",
    endpoint: "arn:aws:sqs:...:q1",
  },
  {
    subscriptionArn: "arn:aws:sns:...:orders:s2",
    topicArn: "arn:aws:sns:...:orders",
    topicName: "orders",
    protocol: "sqs",
    endpoint: "arn:aws:sqs:...:q2",
  },
  {
    subscriptionArn: "arn:aws:sns:...:events:s3",
    topicArn: "arn:aws:sns:...:events.fifo",
    topicName: "events.fifo",
    protocol: "sqs",
    endpoint: "arn:aws:sqs:...:q3",
  },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    sns: {
      listTopics: (...args: unknown[]) => listTopics(...args),
      listAllSubscriptions: (...args: unknown[]) => listAllSubscriptions(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listTopics = vi.fn();
const listAllSubscriptions = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { DashboardPage } from "./DashboardPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectionsProvider>
        <DashboardPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listTopics.mockReset().mockResolvedValue(topics);
  listAllSubscriptions.mockReset().mockResolvedValue(subs);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SNS DashboardPage", () => {
  it("renders topic / subscription / fifo summary counts", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("sns-dash-table-row")).toHaveLength(2));

    expect(within(screen.getByTestId("sns-dash-topics")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("sns-dash-subs")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByTestId("sns-dash-fifo")).getByText("1")).toBeInTheDocument();
  });

  it("has a create-topic quick action", async () => {
    renderPage();
    expect(await screen.findByTestId("sns-dash-create")).toBeInTheDocument();
  });

  it("shows an error banner when loading fails", async () => {
    listTopics.mockRejectedValueOnce({ kind: "connection", message: "boom" });
    renderPage();
    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });
});
