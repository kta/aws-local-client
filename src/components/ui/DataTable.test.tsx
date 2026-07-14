import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "alpha" },
  { id: "2", name: "beta" },
];

const columns: Column<Row>[] = [
  { key: "name", header: "名前" },
];

describe("DataTable", () => {
  it("renders rows with the list variant and default cell text", () => {
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} variant="list" rowTestId="row" />,
    );
    expect(screen.getAllByTestId("row")).toHaveLength(2);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("renders the results variant with font-mono table", () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} variant="results" />,
    );
    expect(container.querySelector("table")?.className).toContain("font-mono");
  });

  it("uses a custom render function", () => {
    const cols: Column<Row>[] = [{ key: "name", header: "名前", render: (r) => <b>{r.name.toUpperCase()}</b> }];
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText("ALPHA")).toBeInTheDocument();
  });

  it("shows the loading row", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByText("読み込み中...")).toBeInTheDocument();
  });

  it("shows the empty text when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyText="ありません" />);
    expect(screen.getByText("ありません")).toBeInTheDocument();
  });

  it("fires onRowClick", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} rowTestId="row" />);
    fireEvent.click(screen.getAllByTestId("row")[0]);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("renders a selection column and toggles", () => {
    const onToggle = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{
          isSelected: () => false,
          onToggle,
          ariaLabel: (r) => `${r.name} を選択`,
        }}
      />,
    );
    const checkbox = screen.getByLabelText("alpha を選択");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(rows[0], 0);
  });

  it("reflects the selected state", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{
          isSelected: (r) => r.id === "1",
          onToggle: () => {},
          ariaLabel: (r) => r.name,
        }}
      />,
    );
    expect(screen.getByLabelText("alpha")).toBeChecked();
    expect(screen.getByLabelText("beta")).not.toBeChecked();
  });
});
