import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to the secondary/md variant", () => {
    render(<Button>ラベル</Button>);
    const btn = screen.getByRole("button", { name: "ラベル" });
    expect(btn.className).toContain("border-[#d9dee3]");
    expect(btn.className).toContain("px-[14px]");
  });

  it("renders the primary variant classes", () => {
    render(<Button variant="primary">実行</Button>);
    expect(screen.getByRole("button").className).toContain("bg-[#0972d3]");
  });

  it("renders the danger variant classes", () => {
    render(<Button variant="danger">削除</Button>);
    expect(screen.getByRole("button").className).toContain("text-[#d13212]");
  });

  it("renders the sm size classes", () => {
    render(<Button size="sm">小</Button>);
    expect(screen.getByRole("button").className).toContain("px-[10px]");
  });

  it("applies disabled treatment to every variant", () => {
    render(
      <Button variant="danger" disabled>
        削除
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
    expect(btn.className).toContain("disabled:opacity-45");
    expect(btn).toBeDisabled();
  });

  it("passes rest props through (data-testid, onClick)", () => {
    render(<Button data-testid="my-btn">x</Button>);
    expect(screen.getByTestId("my-btn")).toBeInTheDocument();
  });

  it("merges a caller className", () => {
    render(<Button className="extra-class">x</Button>);
    expect(screen.getByRole("button").className).toContain("extra-class");
  });
});
