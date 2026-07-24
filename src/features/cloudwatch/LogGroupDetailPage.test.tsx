import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { LogEvent, LogStream } from "../../api/cloudwatch";
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

const sampleStreams: LogStream[] = [
  { name: "stream-a", lastEventAt: null, storedBytes: 128 },
];
const sampleEvents: LogEvent[] = [
  { timestamp: "2026-07-22T05:00:00Z", message: "hello world", stream: null },
];
const filteredEvents: LogEvent[] = [
  { timestamp: "2026-07-22T05:00:00Z", message: "ERROR boom", stream: "stream-a" },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    cloudwatch: {
      listLogStreams: (...args: unknown[]) => listLogStreams(...args),
      getLogEvents: (...args: unknown[]) => getLogEvents(...args),
      filterLogEvents: (...args: unknown[]) => filterLogEvents(...args),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listLogStreams = vi.fn();
const getLogEvents = vi.fn();
const filterLogEvents = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { LogGroupDetailPage } from "./LogGroupDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cloudwatch/log-groups/%2Fnlsd%2Fapp"]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/cloudwatch/log-groups/:name" element={<LogGroupDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listLogStreams.mockReset().mockResolvedValue(sampleStreams);
  getLogEvents.mockReset().mockResolvedValue(sampleEvents);
  filterLogEvents.mockReset().mockResolvedValue(filteredEvents);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LogGroupDetailPage", () => {
  it("lists streams and shows events when a stream is opened", async () => {
    renderPage();
    const link = await screen.findByTestId("stream-link-stream-a");
    fireEvent.click(link);
    await waitFor(() =>
      expect(getLogEvents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/nlsd/app",
        "stream-a",
      ),
    );
    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  it("runs a filter search across the group", async () => {
    renderPage();
    await screen.findByTestId("log-filter-input");
    fireEvent.change(screen.getByTestId("log-filter-input"), { target: { value: "ERROR" } });
    fireEvent.click(screen.getByTestId("log-filter-run"));
    await waitFor(() =>
      expect(filterLogEvents).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "/nlsd/app",
        "ERROR",
      ),
    );
    expect(await screen.findByText("ERROR boom")).toBeInTheDocument();
  });

  it("shows the error banner when listing streams fails", async () => {
    listLogStreams.mockRejectedValue({ kind: "connection", message: "boom" });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
  });
});
