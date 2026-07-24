import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { CacheSummary } from "../../api/elasticache";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
  StatusBadge,
  SummaryCards,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

/** Count caches by engine (redis / valkey / memcached). */
function countByEngine(caches: CacheSummary[], engine: string): number {
  return caches.filter((c) => c.engine === engine).length;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<CacheSummary[]>((profile) => api.elasticache.listCaches(profile));

  const caches = useMemo(() => data ?? [], [data]);

  // R70: an unsupported describe takes over the whole page with the shared
  // elasticache-unsupported banner; other errors stay a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const columns: Column<CacheSummary>[] = [
    {
      key: "id",
      header: "ID",
      className: "font-semibold text-[#0972d3]",
      render: (c) => c.id,
    },
    { key: "engine", header: "エンジン" },
    {
      key: "status",
      header: "ステータス",
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "endpoint",
      header: "エンドポイント",
      render: (c) =>
        c.endpoint ? c.endpoint : <span className="text-[#5f6b7a]">-</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="elasticache-dashboard-heading" />

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

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="elasticache-dashboard-summary"
                items={[
                  {
                    label: "キャッシュ数",
                    value: String(caches.length),
                    testId: "elasticache-dash-total",
                  },
                  {
                    label: "Redis",
                    value: String(countByEngine(caches, "redis")),
                    testId: "elasticache-dash-redis",
                  },
                  {
                    label: "Valkey",
                    value: String(countByEngine(caches, "valkey")),
                    testId: "elasticache-dash-valkey",
                  },
                  {
                    label: "Memcached",
                    value: String(countByEngine(caches, "memcached")),
                    testId: "elasticache-dash-memcached",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/elasticache/caches?create=1")}
                data-testid="elasticache-dash-create"
              >
                キャッシュを作成
              </Button>
            </div>

            <Card title="キャッシュ" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={caches}
                rowKey={(c) => c.id}
                rowTestId="elasticache-dash-table"
                loading={loading}
                emptyText={
                  <span data-testid="elasticache-dash-empty">キャッシュがありません</span>
                }
                onRowClick={() => navigate("/elasticache/caches")}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
