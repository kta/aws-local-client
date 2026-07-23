import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ConnectionProfile } from "../api/types";

const profiles: ConnectionProfile[] = [
  {
    id: "1",
    name: "localstack",
    endpointUrl: "http://localhost:4566",
    region: "ap-northeast-1",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
  },
];

vi.mock("../api/client", () => ({
  api: {
    listConnections: vi.fn(async () => profiles),
  },
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "kind" in e
      ? e
      : { kind: "internal", message: String(e) },
}));

import { ConnectionsProvider } from "../state/connections";
import { Home } from "./Home";

async function renderHome() {
  render(
    <MemoryRouter>
      <ConnectionsProvider>
        <Home />
      </ConnectionsProvider>
    </MemoryRouter>,
  );
  // Flush the provider's async connection load before assertions.
  await screen.findByTestId("service-search");
}

describe("Home service grid", () => {
  it("filters services by a case-insensitive substring of name/id", async () => {
    await renderHome();
    // Sanity: an unrelated service is visible before filtering.
    expect(screen.getByText("Lambda")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("service-search"), { target: { value: "DYNAMO" } });

    expect(screen.getByText("DynamoDB")).toBeInTheDocument();
    expect(screen.queryByText("Lambda")).not.toBeInTheDocument();
    // id match: filtering by the "sqs" id keeps the SQS card.
    fireEvent.change(screen.getByTestId("service-search"), { target: { value: "sqs" } });
    expect(screen.getByText("SQS")).toBeInTheDocument();
    expect(screen.queryByText("DynamoDB")).not.toBeInTheDocument();
  });

  it("shows an empty message when nothing matches", async () => {
    await renderHome();
    fireEvent.change(screen.getByTestId("service-search"), { target: { value: "zzzznope" } });

    expect(screen.getByTestId("service-search-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("service-dynamodb")).not.toBeInTheDocument();
  });

  it("renders enabled services before coming-soon ones", async () => {
    await renderHome();
    const dynamodb = screen.getByTestId("service-dynamodb"); // enabled
    const comingSoon = screen.getByText("EC2"); // coming soon

    // DynamoDB (enabled) must appear before EC2 (coming soon) in the DOM.
    const ordered = dynamodb.compareDocumentPosition(comingSoon);
    expect(ordered & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
