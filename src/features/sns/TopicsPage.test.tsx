import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TopicSummary } from "../../api/sns";
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

const sampleTopics: TopicSummary[] = [
  {
    topicArn: "arn:aws:sns:ap-northeast-1:000000000000:orders",
    name: "orders",
    fifo: false,
  },
  {
    topicArn: "arn:aws:sns:ap-northeast-1:000000000000:events.fifo",
    name: "events.fifo",
    fifo: true,
  },
];

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    sns: {
      listTopics: (...args: unknown[]) => listTopics(...args),
      createTopic: (...args: unknown[]) => createTopic(...args),
      deleteTopic: (...args: unknown[]) => deleteTopic(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listTopics = vi.fn();
const createTopic = vi.fn();
const deleteTopic = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { TopicsPage } from "./TopicsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sns/topics"]}>
      <ConnectionsProvider>
        <TopicsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listTopics.mockReset().mockResolvedValue(sampleTopics);
  createTopic.mockReset().mockResolvedValue(undefined);
  deleteTopic.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TopicsPage", () => {
  it("renders topic rows with name and type", async () => {
    renderPage();
    expect(await screen.findByTestId("topic-link-orders")).toBeInTheDocument();
    expect(screen.getByTestId("topic-link-events.fifo")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("FIFO")).toBeInTheDocument();
  });

  it("creates a topic and reloads the list", async () => {
    renderPage();
    await screen.findByTestId("topics-create");

    fireEvent.click(screen.getByTestId("topics-create"));
    fireEvent.change(await screen.findByTestId("t-name"), { target: { value: "new-t" } });
    fireEvent.click(screen.getByTestId("t-save"));

    await waitFor(() =>
      expect(createTopic).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "new-t",
        false,
      ),
    );
    await waitFor(() => expect(listTopics).toHaveBeenCalledTimes(2));
  });

  it("previews the .fifo suffix when FIFO is checked", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("topics-create"));
    fireEvent.change(await screen.findByTestId("t-name"), { target: { value: "events" } });
    fireEvent.click(screen.getByTestId("t-fifo"));
    expect(await screen.findByTestId("t-name-preview")).toHaveTextContent("events.fifo");
  });

  it("deletes a topic after typing its name to confirm", async () => {
    renderPage();
    const checkbox = await screen.findByLabelText("orders を選択");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("topics-delete"));

    const confirm = screen.getByTestId("topics-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("topics-delete-input"), { target: { value: "orders" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteTopic).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        sampleTopics[0].topicArn,
      ),
    );
  });

  it("shows the error banner when listing fails", async () => {
    listTopics.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listTopics).not.toHaveBeenCalled();
  });
});
