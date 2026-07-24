import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { CacheSummary, CreateCacheRequest } from "../../api/elasticache";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateCacheModal } from "./CreateCacheModal";

export function CachesPage() {
  const { active } = useConnections();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<CacheSummary[]>((profile) => api.elasticache.listCaches(profile));
  const caches = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CacheSummary | null>(null);

  // Dashboard quick action deep-links here with ?create=1 to open the modal.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      searchParams.delete("create");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // R70: an "unsupported" load error takes over from the generic error banner and
  // hides the create action. A create error that is NOT unsupported stays a
  // normal error banner while the list keeps rendering.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = opError ?? (loadError && !unsupported ? loadError : null);

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const createCache = async (req: CreateCacheRequest) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.elasticache.createCache(active, req);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<CacheSummary>[] = [
    {
      key: "id",
      header: "ID",
      className: "font-semibold",
      render: (c) => <span data-testid={`cache-row-${c.id}`}>{c.id}</span>,
    },
    { key: "engine", header: "エンジン" },
    {
      key: "status",
      header: "ステータス",
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "nodeType",
      header: "ノードタイプ",
      render: (c) =>
        c.nodeType ? c.nodeType : <span className="text-[#5f6b7a]">-</span>,
    },
    { key: "numNodes", header: "ノード数", render: (c) => String(c.numNodes) },
    {
      key: "endpoint",
      header: "エンドポイント",
      render: (c) =>
        c.endpoint ? c.endpoint : <span className="text-[#5f6b7a]">-</span>,
    },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (c) => (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setDeleting(c)}
            data-testid="caches-delete"
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
          title="キャッシュ"
          count={unsupported ? undefined : caches.length}
          titleTestId="caches-heading"
          countTestId="caches-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="caches-create">
              キャッシュを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="elasticache-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは ElastiCache API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">
              対応エミュレータ: ministack、floci、kumo(localstack は Pro 専用)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={caches}
              rowKey={(c) => c.id}
              loading={loading}
              emptyText={<span data-testid="caches-empty">キャッシュがありません</span>}
            />
          </Card>
        )}

        {creating && (
          <CreateCacheModal onSubmit={createCache} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="キャッシュの削除"
            description={
              <>
                キャッシュ <b className="font-mono text-[#16191f]">{deleting.id}</b>{" "}
                を削除します。確認のため ID を入力してください。
              </>
            }
            requiredText={deleting.id}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.elasticache.deleteCache(active, deleting.id, deleting.kind);
              setDeleting(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="caches-delete-input"
            confirmTestId="caches-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
