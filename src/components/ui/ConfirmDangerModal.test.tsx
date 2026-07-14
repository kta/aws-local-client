import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/client", () => ({
  toAppError: (e: unknown) =>
    typeof e === "object" && e !== null && "message" in e
      ? (e as { kind: string; message: string })
      : { kind: "internal", message: String(e) },
}));

import { ConfirmDangerModal } from "./ConfirmDangerModal";

describe("ConfirmDangerModal", () => {
  it("keeps confirm disabled until the text matches", () => {
    render(
      <ConfirmDangerModal
        title="テーブルの削除"
        description="確認のためテーブル名を入力してください。"
        requiredText="orders"
        confirmLabel="削除"
        onConfirm={async () => {}}
        onClose={() => {}}
        inputTestId="delete-input"
        confirmTestId="delete-confirm"
      />,
    );
    const confirm = screen.getByTestId("delete-confirm");
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-input"), { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-input"), { target: { value: "orders" } });
    expect(confirm).toBeEnabled();
  });

  it("shows an inline error when onConfirm rejects", async () => {
    const onConfirm = vi.fn(async () => {
      throw { kind: "internal", message: "削除に失敗しました" };
    });
    render(
      <ConfirmDangerModal
        title="テーブルの削除"
        description="d"
        requiredText="orders"
        confirmLabel="削除"
        onConfirm={onConfirm}
        onClose={() => {}}
        inputTestId="delete-input"
        confirmTestId="delete-confirm"
      />,
    );
    fireEvent.change(screen.getByTestId("delete-input"), { target: { value: "orders" } });
    fireEvent.click(screen.getByTestId("delete-confirm"));

    expect(await screen.findByText("削除に失敗しました")).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onConfirm when confirmed successfully", async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <ConfirmDangerModal
        title="t"
        description="d"
        requiredText="orders"
        confirmLabel="削除"
        onConfirm={onConfirm}
        onClose={() => {}}
        inputTestId="delete-input"
        confirmTestId="delete-confirm"
      />,
    );
    fireEvent.change(screen.getByTestId("delete-input"), { target: { value: "orders" } });
    fireEvent.click(screen.getByTestId("delete-confirm"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});
