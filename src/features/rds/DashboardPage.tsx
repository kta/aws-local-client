import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { DbInstanceSummary } from "../../api/rds";
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

interface DashboardData {
  instances: DbInstanceSummary[];
  // null when the snapshot API is unsupported by this emulator (card shows "-").
  snapshotCount: number | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const instances = await api.rds.listInstances(profile);
    // The snapshot count is best-effort: an unsupported error yields "-" but
    // must not fail the whole dashboard (R47).
    let snapshotCount: number | null = null;
    try {
      snapshotCount = (await api.rds.listSnapshots(profile)).length;
    } catch {
      snapshotCount = null;
    }
    return { instances, snapshotCount };
  });

  const instances = useMemo(() => data?.instances ?? [], [data]);
  const snapshotCount = data?.snapshotCount ?? null;

  // R34/R47: an unsupported describe takes over the whole page with the shared
  // rds-unsupported banner; other errors stay a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const availableCount = instances.filter((i) => i.status === "available").length;

  const columns: Column<DbInstanceSummary>[] = [
    {
      key: "id",
      header: "識別子",
      className: "font-semibold text-[#0972d3]",
      render: (i) => i.id,
    },
    { key: "engine", header: "エンジン" },
    {
      key: "status",
      header: "ステータス",
      render: (i) => <StatusBadge status={i.status} />,
    },
    { key: "instanceClass", header: "クラス" },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="rds-dashboard-heading" />

        {unsupported && (
          <div
            data-testid="rds-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは RDS API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">
              対応エミュレータ: ministack、floci(--volume /var/run/docker.sock マウント時)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="rds-dashboard-summary"
                items={[
                  {
                    label: "インスタンス数",
                    value: String(instances.length),
                    testId: "rds-dash-instances",
                  },
                  {
                    label: "利用可能",
                    value: String(availableCount),
                    testId: "rds-dash-available",
                  },
                  {
                    label: "スナップショット数",
                    value: snapshotCount == null ? "-" : String(snapshotCount),
                    testId: "rds-dash-snapshots",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/rds/instances?create=1")}
                data-testid="rds-dash-create"
              >
                データベースを作成
              </Button>
            </div>

            <Card title="データベース" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={instances}
                rowKey={(i) => i.id}
                rowTestId="rds-dash-table"
                loading={loading}
                emptyText={
                  <span data-testid="rds-dash-empty">データベースインスタンスがありません</span>
                }
                onRowClick={() => navigate("/rds/instances")}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
