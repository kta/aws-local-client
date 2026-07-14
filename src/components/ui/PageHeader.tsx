interface PageHeaderProps {
  title: string;
  count?: number; // when set, renders "(n)" in muted grey
  titleTestId?: string; // e.g. "tables-heading"
  countTestId?: string; // e.g. "tables-count"
  children?: React.ReactNode; // right-aligned actions (spacer inserted internally)
}

/** Standard page header row (§1.6 / §2.3): title, optional count, spacer, actions. */
export function PageHeader({ title, count, titleTestId, countTestId, children }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="text-[20px] font-bold" data-testid={titleTestId}>
        {title}
      </h1>
      {count !== undefined && (
        <span className="text-[12.5px] text-[#5f6b7a]" data-testid={countTestId}>
          ({count})
        </span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}
