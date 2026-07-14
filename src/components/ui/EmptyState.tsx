interface EmptyStateProps {
  message: React.ReactNode;
  action?: React.ReactNode; // e.g. Dashboard "最初のテーブルを作成" link
  testId?: string;
}

/** Centered empty-state block for placement inside a Card (§2.10). */
export function EmptyState({ message, action, testId }: EmptyStateProps) {
  return (
    <div className="p-8 text-center text-[#5f6b7a]" data-testid={testId}>
      <p className={action ? "mb-3" : undefined}>{message}</p>
      {action}
    </div>
  );
}
