import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { GlobalSubscription } from "../../api/sns";
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

const confirmed: GlobalSubscription = {
  subscriptionArn: "arn:aws:sns:ap-northeast-1:000000000000:orders:sub-1",
  topicArn: "arn:aws:sns:ap-northeast-1:000000000000:orders",
  topicName: "orders",
  protocol: "sqs",
  endpoint: "arn:aws:sqs:ap-northeast-1:000000000000:orders-queue",
};
const pending: GlobalSubscription = {
  subscriptionArn: "PendingConfirmation",
  topicArn: "arn:aws:sns:ap-northeast-1:000000000000:alerts",
  topicName: "alerts",
  protocol: "email",
  endpoint: "ops@example.com",
};

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    sns: {
      listAllSubscriptions: (...args: unknown[]) => listAllSubscriptions(...args),
      unsubscribe: (...args: unknown[]) => unsubscribe(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listAllSubscriptions = vi.fn();
const unsubscribe = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { SubscriptionsPage } from "./SubscriptionsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sns/subscriptions"]}>
      <ConnectionsProvider>
        <SubscriptionsPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listAllSubscriptions.mockReset().mockResolvedValue([confirmed, pending]);
  unsubscribe.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SubscriptionsPage", () => {
  it("lists subscriptions across topics", async () => {
    renderPage();
    expect(await screen.findByTestId("subscriptions-table")).toBeInTheDocument();
    expect(await screen.findByTestId("gsub-row-orders")).toBeInTheDocument();
    expect(screen.getByTestId("gsub-row-alerts")).toBeInTheDocument();
  });

  it("disables the remove button for a PendingConfirmation subscription", async () => {
    renderPage();
    await screen.findByTestId("gsub-row-alerts");
    const buttons = screen.getAllByTestId("gsub-remove");
    // Confirmed subscription can be removed; pending one cannot.
    const enabled = buttons.filter((b) => !(b as HTMLButtonElement).disabled);
    const disabled = buttons.filter((b) => (b as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);
    expect(disabled).toHaveLength(1);
  });

  it("unsubscribes after confirming", async () => {
    renderPage();
    await screen.findByTestId("gsub-row-orders");
    const removeButton = screen
      .getAllByTestId("gsub-remove")
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(removeButton);

    const confirm = await screen.findByTestId("gsub-remove-confirm");
    fireEvent.change(screen.getByTestId("gsub-remove-input"), {
      target: { value: "orders-queue" },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(unsubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        confirmed.subscriptionArn,
      ),
    );
  });

  it("shows an error banner when loading fails", async () => {
    listAllSubscriptions.mockRejectedValueOnce({ kind: "connection", message: "boom" });
    renderPage();
    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });
});
