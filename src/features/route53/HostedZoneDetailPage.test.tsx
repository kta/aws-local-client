import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { HostedZoneSummary, RecordSet } from "../../api/route53";
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

const zones: HostedZoneSummary[] = [
  { id: "/hostedzone/Z1", name: "example.com.", recordCount: 3, privateZone: false },
];

const records: RecordSet[] = [
  { name: "example.com.", recordType: "NS", ttl: 172800, values: ["ns-1.example.com."] },
  { name: "www.example.com.", recordType: "A", ttl: 300, values: ["1.2.3.4"] },
];

vi.mock("../../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
    route53: {
      listHostedZones: (...a: unknown[]) => listHostedZones(...a),
      listRecordSets: (...a: unknown[]) => listRecordSets(...a),
      changeRecordSet: (...a: unknown[]) => changeRecordSet(...a),
    },
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e && "message" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

const listHostedZones = vi.fn();
const listRecordSets = vi.fn();
const changeRecordSet = vi.fn();

import { ConnectionsProvider } from "../../state/connections";
import { HostedZoneDetailPage } from "./HostedZoneDetailPage";

function renderPage() {
  const encoded = encodeURIComponent("/hostedzone/Z1");
  return render(
    <MemoryRouter initialEntries={[`/route53/hosted-zones/${encoded}`]}>
      <ConnectionsProvider>
        <Routes>
          <Route path="/route53/hosted-zones/:id" element={<HostedZoneDetailPage />} />
        </Routes>
      </ConnectionsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listHostedZones.mockReset().mockResolvedValue(zones);
  listRecordSets.mockReset().mockResolvedValue(records);
  changeRecordSet.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("HostedZoneDetailPage", () => {
  it("lists records including NS/SOA and passes the bare zone id to the API", async () => {
    renderPage();
    expect(await screen.findByTestId("record-name-www.example.com.")).toHaveTextContent(
      "www.example.com.",
    );
    expect(screen.getByTestId("record-name-example.com.")).toBeInTheDocument();
    expect(listRecordSets).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), "Z1");
  });

  it("creates a record with CREATE and multi-line values", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("record-create"));
    fireEvent.change(screen.getByTestId("record-name"), { target: { value: "api.example.com" } });
    fireEvent.change(screen.getByTestId("record-values"), {
      target: { value: "1.1.1.1\n2.2.2.2" },
    });
    fireEvent.click(screen.getByTestId("record-save"));
    await waitFor(() =>
      expect(changeRecordSet).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "Z1",
        "CREATE",
        expect.objectContaining({
          name: "api.example.com",
          recordType: "A",
          values: ["1.1.1.1", "2.2.2.2"],
        }),
      ),
    );
  });

  it("edits a record via UPSERT with name/type locked", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("record-edit-www.example.com."));
    const nameInput = screen.getByTestId("record-name") as HTMLInputElement;
    expect(nameInput).toBeDisabled();
    fireEvent.change(screen.getByTestId("record-values"), { target: { value: "9.9.9.9" } });
    fireEvent.click(screen.getByTestId("record-save"));
    await waitFor(() =>
      expect(changeRecordSet).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "Z1",
        "UPSERT",
        expect.objectContaining({ name: "www.example.com.", recordType: "A", values: ["9.9.9.9"] }),
      ),
    );
  });

  it("deletes a record with DELETE after confirming", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("record-delete-www.example.com."));
    fireEvent.click(screen.getByTestId("record-delete-confirm"));
    await waitFor(() =>
      expect(changeRecordSet).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1" }),
        "Z1",
        "DELETE",
        expect.objectContaining({ name: "www.example.com.", recordType: "A" }),
      ),
    );
  });
});
