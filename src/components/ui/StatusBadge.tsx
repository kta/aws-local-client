interface StatusBadgeProps {
  status: string; // "ACTIVE" renders as green "アクティブ"; other values render raw
  testId?: string;
}

/** Green "● アクティブ" badge for ACTIVE, otherwise the raw status (§2.8). */
export function StatusBadge({ status, testId }: StatusBadgeProps) {
  if (status !== "ACTIVE") return <span data-testid={testId}>{status}</span>;
  return (
    <span className="text-[12.5px] font-semibold text-[#037f0c]" data-testid={testId}>
      <span className="mr-1 align-[1px] text-[9px]">●</span>
      アクティブ
    </span>
  );
}
