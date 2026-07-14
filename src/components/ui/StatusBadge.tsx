interface StatusBadgeProps {
  status: string; // "ACTIVE"/"available" render green; other values render raw
  testId?: string;
}

// Active-like statuses that render as a green badge. "ACTIVE" (DynamoDB) shows the
// Japanese label "アクティブ"; "available" (RDS, case-insensitive) keeps its raw
// text so downstream (E2E) can still match on it.
function activeLabel(status: string): string | null {
  if (status === "ACTIVE") return "アクティブ";
  if (status.toLowerCase() === "available") return status;
  return null;
}

/** Green "● …" badge for active-like statuses, otherwise the raw status (§2.8). */
export function StatusBadge({ status, testId }: StatusBadgeProps) {
  const label = activeLabel(status);
  if (label === null) return <span data-testid={testId}>{status}</span>;
  return (
    <span className="text-[12.5px] font-semibold text-[#037f0c]" data-testid={testId}>
      <span className="mr-1 align-[1px] text-[9px]">●</span>
      {label}
    </span>
  );
}
