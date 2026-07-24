import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { NamedQuerySummary } from "../../api/athena";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

export function SavedQueriesPage() {
  const { active } = useConnections();
  const navigate = useNavigate();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<NamedQuerySummary[]>((profile) =>
    api.athena.listNamedQueries(profile),
  );
  const queries = data ?? [];
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [deleting, setDeleting] = useState<NamedQuerySummary | null>(null);

  // An unsupported list takes over the page with the athena-unsupported banner;
  // other errors stay a normal error banner (RDS DashboardPage pattern).
  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const listError = fetchError && !unsupported ? fetchError : null;

  // Load a saved query into the editor via ?q=<encoded statement>.
  const insertIntoEditor = (q: NamedQuerySummary) => {
    navigate(`/athena?q=${encodeURIComponent(q.queryString)}`);
  };

  const columns: Column<NamedQuerySummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (q) => <span data-testid={`saved-query-row-${q.name}`}>{q.name}</span>,
    },
    { key: "database", header: "データベース", render: (q) => q.database ?? "-" },
    {
      key: "queryString",
      header: "クエリ",
      className: "max-w-[360px] truncate font-mono text-[12px] text-[#5f6b7a]",
      render: (q) => q.queryString,
    },
    {
      key: "actions",
      header: "",
      render: (q) => (
        <div className="flex gap-3">
          <button
            onClick={() => insertIntoEditor(q)}
            data-testid={`saved-query-insert-${q.name}`}
            className="text-[13px] font-semibold text-[#0972d3] hover:underline"
          >
            エディタへ挿入
          </button>
          <button
            onClick={() => setDeleting(q)}
            data-testid={`saved-query-delete-${q.name}`}
            className="text-[13px] font-semibold text-[#d13212] hover:underline"
          >
            削除
          </button>
        </div>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="保存したクエリ"
          count={unsupported ? undefined : queries.length}
          titleTestId="saved-queries-heading"
          countTestId="saved-queries-count"
        />

        {unsupported && (
          <div
            data-testid="athena-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは Athena の保存したクエリをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? listError} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={queries}
              rowKey={(q) => q.id}
              loading={loading}
              emptyText={listError ? undefined : "保存したクエリがありません"}
            />
          </Card>
        )}

        {deleting && (
          <ConfirmDangerModal
            title="保存したクエリの削除"
            description={
              <>
                クエリ <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.athena.deleteNamedQuery(active, deleting.id);
              setDeleting(null);
              setActionError(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="saved-queries-delete-input"
            confirmTestId="saved-queries-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
