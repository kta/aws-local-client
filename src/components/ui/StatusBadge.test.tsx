import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { StatusBadge } from "./StatusBadge";

// The green class used for active-like statuses.
const GREEN = "text-[#037f0c]";

describe("StatusBadge", () => {
  it("renders ACTIVE as a green アクティブ badge", () => {
    render(<StatusBadge status="ACTIVE" testId="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("アクティブ");
    expect(badge).toHaveClass(GREEN);
  });

  it("renders available (case-insensitive) green while keeping its raw text", () => {
    render(<StatusBadge status="available" testId="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("available");
    expect(badge).toHaveClass(GREEN);
  });

  it("renders other statuses as raw text without the green class", () => {
    render(<StatusBadge status="CREATING" testId="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("CREATING");
    expect(badge).not.toHaveClass(GREEN);
  });
});
