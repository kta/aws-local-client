import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { EventBusSummary, RuleSummary, TargetSummary } from "../../api/eventbridge";
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
  { name: "default", arn: null },
  { name: "orders-bus", arn: null },
];

const enabledRule: RuleSummary = {
  name: "r-enabled",
  arn: null,
  state: "ENABLED",
  scheduleExpression: null,
  eventPattern: '{"source":["nlsd.app"]}',
  description: null,
  eventBusName: "default",
};

let noProfiles = false;

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => (noProfiles ? [] : profiles)),
    eventbridge: {
      listBuses: (...args: unknown[]) => listBuses(...args),
      listRules: (...args: unknown[]) => listRules(...args),
      putRule: (...args: unknown[]) => putRule(...args),
      deleteRule: (...args: unknown[]) => deleteRule(...args),
      enableRule: (...args: unknown[]) => enableRule(...args),
      disableRule: (...args: unknown[]) => disableRule(...args),
      listTargets: (...args: unknown[]) => listTargets(...args),
      putTarget: (...args: unknown[]) => putTarget(...args),
      removeTarget: (...args: unknown[]) => removeTarget(...args),
      putEvents: (...args: unknown[]) => putEvents(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listBuses = vi.fn();
const listRules = vi.fn();
const putRule = vi.fn();
const deleteRule = vi.fn();
const enableRule = vi.fn();
const disableRule = vi.fn();
const listTargets = vi.fn();
const putTarget = vi.fn();
const removeTarget = vi.fn();
const putEvents = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { RulesPage } from "./RulesPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/eventbridge/rules"]}>
      <ConnectionsProvider>
        <RulesPage />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  noProfiles = false;
  listBuses.mockReset().mockResolvedValue(sampleBuses);
  listRules.mockReset().mockResolvedValue([enabledRule]);
  putRule.mockReset().mockResolvedValue(undefined);
  deleteRule.mockReset().mockResolvedValue(undefined);
  enableRule.mockReset().mockResolvedValue(undefined);
  disableRule.mockReset().mockResolvedValue(undefined);
  listTargets.mockReset().mockResolvedValue([] as TargetSummary[]);
  putTarget.mockReset().mockResolvedValue(undefined);
  removeTarget.mockReset().mockResolvedValue(undefined);
  putEvents.mockReset().mockResolvedValue({ failedCount: 0, eventIds: ["ev-1"] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("eventbridge RulesPage", () => {
  it("renders the bus selector with the fetched buses", async () => {
    renderPage();
    const select = (await screen.findByTestId("rules-bus-select")) as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.value)).toContain("orders-bus"),
    );
  });

  it("lists rules for the selected bus with their state", async () => {
    renderPage();
    expect(await screen.findByTestId("rule-row-r-enabled")).toBeInTheDocument();
    expect(screen.getByTestId("rule-state-r-enabled")).toHaveTextContent("有効");
  });

  it("creates a rule and reloads", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("rules-create"));
    fireEvent.change(await screen.findByTestId("rule-name"), { target: { value: "new-rule" } });
    fireEvent.click(screen.getByTestId("rule-save"));
    await waitFor(() =>
      expect(putRule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ name: "new-rule", enabled: true }),
      ),
    );
  });

  it("disables an enabled rule via the toggle", async () => {
    renderPage();
    await screen.findByTestId("rule-row-r-enabled");
    fireEvent.click(screen.getByTestId("rule-toggle-r-enabled"));
    await waitFor(() =>
      expect(disableRule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "r-enabled",
        "default",
      ),
    );
  });

  it("deletes a rule after typing its name", async () => {
    renderPage();
    await screen.findByTestId("rule-row-r-enabled");
    fireEvent.click(screen.getByTestId("rule-delete-r-enabled"));
    const confirm = screen.getByTestId("rule-delete-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("rule-delete-input"), { target: { value: "r-enabled" } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteRule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "r-enabled",
        "default",
      ),
    );
  });

  it("adds a target to a selected rule", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("rule-row-r-enabled"));
    const arn = "arn:aws:sqs:ap-northeast-1:000000000000:q1";
    fireEvent.change(await screen.findByTestId("target-arn"), { target: { value: arn } });
    fireEvent.click(screen.getByTestId("target-add"));
    await waitFor(() =>
      expect(putTarget).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "r-enabled",
        "default",
        expect.any(String),
        arn,
      ),
    );
  });

  it("removes a target from a selected rule", async () => {
    listTargets.mockResolvedValue([{ id: "t1", arn: "arn:aws:sqs:...:q1" }]);
    renderPage();
    fireEvent.click(await screen.findByTestId("rule-row-r-enabled"));
    fireEvent.click(await screen.findByTestId("target-remove-t1"));
    await waitFor(() =>
      expect(removeTarget).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "r-enabled",
        "default",
        "t1",
      ),
    );
  });

  it("sends an event and shows the result", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("rules-put-events"));
    fireEvent.change(await screen.findByTestId("pe-source"), { target: { value: "nlsd.e2e" } });
    fireEvent.click(screen.getByTestId("pe-save"));
    await waitFor(() =>
      expect(putEvents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "default",
        "nlsd.e2e",
        expect.any(String),
        expect.any(String),
      ),
    );
    expect(await screen.findByTestId("put-events-result")).toBeInTheDocument();
  });

  it("keeps the send button disabled when detail is not valid JSON", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("rules-put-events"));
    fireEvent.change(await screen.findByTestId("pe-detail"), { target: { value: "not-json" } });
    expect(screen.getByTestId("pe-save")).toBeDisabled();
    expect(screen.getByTestId("pe-detail-invalid")).toBeInTheDocument();
  });

  it("shows the error banner when listing rules fails", async () => {
    listRules.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });

  it("shows the connection-required prompt when no profile is active", async () => {
    noProfiles = true;
    renderPage();
    await waitFor(() => expect(screen.getByText(/接続が未登録です/)).toBeInTheDocument());
    expect(listRules).not.toHaveBeenCalled();
  });
});
