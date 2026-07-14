import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { Modal, ModalFooter } from "./Modal";

describe("Modal", () => {
  it("renders title and children", () => {
    render(
      <Modal title="タイトル" onClose={() => {}}>
        <div>本文</div>
      </Modal>,
    );
    expect(screen.getByText("タイトル")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="t" onClose={onClose}>
        <div>本文</div>
      </Modal>,
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the panel is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal title="t" onClose={onClose}>
        <div>本文</div>
      </Modal>,
    );
    fireEvent.click(screen.getByText("本文"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("applies the requested max width", () => {
    const { container } = render(
      <Modal title="t" onClose={() => {}} maxWidth="2xl">
        <div>本文</div>
      </Modal>,
    );
    expect((container.querySelector(".max-w-2xl") as Element)).toBeInTheDocument();
  });
});

describe("ModalFooter", () => {
  it("renders the confirm label and calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ModalFooter onCancel={() => {}} onConfirm={onConfirm} confirmLabel="作成" confirmTestId="submit" />,
    );
    fireEvent.click(screen.getByTestId("submit"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("shows the confirming label and disables while busy", () => {
    render(
      <ModalFooter
        onCancel={() => {}}
        onConfirm={() => {}}
        confirmLabel="作成"
        confirmingLabel="作成中..."
        confirmTestId="submit"
        busy
      />,
    );
    const btn = screen.getByTestId("submit");
    expect(btn).toHaveTextContent("作成中...");
    expect(btn).toBeDisabled();
  });

  it("honours confirmDisabled", () => {
    render(
      <ModalFooter
        onCancel={() => {}}
        onConfirm={() => {}}
        confirmLabel="作成"
        confirmTestId="submit"
        confirmDisabled
      />,
    );
    expect(screen.getByTestId("submit")).toBeDisabled();
  });
});
