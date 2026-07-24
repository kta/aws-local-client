import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { ClusterSummary } from "../../api/ecs";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
  SummaryCards,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { EcsUnsupported } from "./EcsUnsupported";

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<ClusterSummary[]>((profile) => api.ecs.listClusters(profile));

  const clusters = useMemo(() => data ?? [], [data]);

  // R75: an unsupported ListClusters takes over the whole page with the shared
  // ecs-unsupported banner; other errors stay a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const totals = useMemo(
    () =>
      clusters.reduce(
        (acc, c) => {
          acc.services += c.activeServicesCount;
          acc.tasks += c.runningTasksCount;
          return acc;
        },
        { services: 0, tasks: 0 },
      ),
    [clusters],
  );

  const columns: Column<ClusterSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (c) => c.name,
    },
    { key: "status", header: "ステータス" },
    { key: "services", header: "サービス数", render: (c) => String(c.activeServicesCount) },
    { key: "tasks", header: "実行中タスク数", render: (c) => String(c.runningTasksCount) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="ecs-dashboard-heading" />

        {unsupported && <EcsUnsupported error={unsupported} />}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="ecs-dashboard-summary"
                items={[
                  {
                    label: "クラスター数",
                    value: String(clusters.length),
                    testId: "ecs-dash-clusters",
                  },
                  {
                    label: "サービス数",
                    value: String(totals.services),
                    testId: "ecs-dash-services",
                  },
                  {
                    label: "実行中タスク数",
                    value: String(totals.tasks),
                    testId: "ecs-dash-tasks",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/ecs/clusters?create=1")}
                data-testid="ecs-dash-create"
              >
                クラスターを作成
              </Button>
            </div>

            <Card title="クラスター" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={clusters}
                rowKey={(c) => c.name}
                rowTestId="ecs-dash-table"
                loading={loading}
                emptyText={
                  <span data-testid="ecs-dash-empty">クラスターがありません</span>
                }
                onRowClick={(c) => navigate(`/ecs/clusters/${encodeURIComponent(c.name)}`)}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
