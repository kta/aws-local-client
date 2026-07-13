import type { AppError } from "../api/types";

const LABELS: Record<string, string> = {
  connection: "接続できません",
  not_found: "リソースが見つかりません",
  validation: "入力内容に問題があります",
  internal: "エラーが発生しました",
};

export function ErrorBanner({ error, onRetry }: { error: AppError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div
      data-testid="error-banner"
      className="m-4 flex items-center justify-between rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <div>
        <span className="font-semibold">{LABELS[error.kind] ?? LABELS.internal}: </span>
        {error.message}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          data-testid="error-retry"
          className="ml-4 rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
        >
          再試行
        </button>
      )}
    </div>
  );
}
