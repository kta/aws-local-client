import { cx } from "./tokens";

export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  render?: (row: Row) => React.ReactNode; // default is String(row[key])
  className?: string; // applied to <td> (e.g. max-w truncate)
  headerClassName?: string;
}

interface Selection<Row> {
  isSelected: (row: Row, index: number) => boolean;
  onToggle: (row: Row, index: number) => void;
  ariaLabel?: (row: Row) => string;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  variant?: "list" | "results"; // two thead style systems (§1.2)
  loading?: boolean; // spans a "読み込み中..." row
  emptyText?: React.ReactNode; // rendered when there are 0 rows
  onRowClick?: (row: Row) => void; // hover cursor-pointer (Dashboard rows)
  selection?: Selection<Row>; // leading checkbox column
  rowTestId?: string; // e.g. "backup-row" / "explore-row"
}

// Two style systems copied verbatim: "list" from TablesPage/DashboardPage,
// "results" from ExplorePage/PartiqlPage (§1.2).
const STYLES = {
  list: {
    table: "w-full border-collapse [font-variant-numeric:tabular-nums]",
    headRow:
      "[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a] [&>th]:whitespace-nowrap",
    bodyRow:
      "[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] [&>td]:whitespace-nowrap last:[&>td]:border-b-0 hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]",
    th: "",
    td: "",
    selectTh: "w-9",
    selectTd: "",
  },
  results: {
    table: "w-full text-left font-mono text-xs",
    headRow: "bg-[#f5f6f7] text-[12px] text-[#5f6b7a]",
    bodyRow: "hover:bg-[#0972d30d]",
    th: "border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold",
    td: "border-b border-[#e9ecef] px-[14px] py-[9px]",
    selectTh: "w-8 border-b border-[#d9dee3] px-[14px] py-[9px]",
    selectTd: "border-b border-[#e9ecef] px-[14px] py-[9px]",
  },
} as const;

/** Column-driven table covering both the list and results style systems (§2.5). */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  variant = "list",
  loading,
  emptyText,
  onRowClick,
  selection,
  rowTestId,
}: DataTableProps<Row>) {
  const s = STYLES[variant];
  const colSpan = columns.length + (selection ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className={s.table}>
        <thead>
          <tr className={s.headRow}>
            {selection && <th className={s.selectTh} />}
            {columns.map((c) => (
              <th key={c.key} className={cx(s.th, c.headerClassName)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={colSpan} className="p-6 text-center text-[#5f6b7a]">
                読み込み中...
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="p-6 text-center text-[#5f6b7a]">
                {emptyText}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                data-testid={rowTestId}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(s.bodyRow, onRowClick && "cursor-pointer")}
              >
                {selection && (
                  <td className={s.selectTd}>
                    <input
                      type="checkbox"
                      aria-label={selection.ariaLabel?.(row)}
                      checked={selection.isSelected(row, i)}
                      onChange={() => selection.onToggle(row, i)}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cx(s.td, c.className)}>
                    {c.render
                      ? c.render(row)
                      : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
