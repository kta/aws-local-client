import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { MskClusterSummary } from "../../api/msk";
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
import { UnsupportedBanner } from "./UnsupportedBanner";

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<MskClusterSummary[]>((profile) => api.msk.listClusters(profile));

  const clusters = useMemo(() => data ?? [], [data]);

  // R93: an unsupported list takes over the whole page with the shared
  // msk-unsupported banner; other errors stay a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const activeCount = clusters.filter((c) => c.state === "ACTIVE").length;

  const columns: Column<MskClusterSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (c) => c.name,
    },
    {
      key: "state",
      header: "状態",
      render: (c) => <StatusBadge status={c.state} />,
    },
    {
      key: "brokers",
      header: "ブローカー数",
      render: (c) => (c.numberOfBrokerNodes == null ? "-" : String(c.numberOfBrokerNodes)),
    },
    { key: "kafkaVersion", header: "Kafka バージョン", render: (c) => c.kafkaVersion ?? "-" },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="msk-dashboard-heading" />

        {unsupported && <UnsupportedBanner error={unsupported} />}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="msk-dashboard-summary"
                items={[
                  {
                    label: "クラスター数",
                    value: String(clusters.length),
                    testId: "msk-dash-clusters",
                  },
                  {
                    label: "アクティブ",
                    value: String(activeCount),
                    testId: "msk-dash-active",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/msk/clusters?create=1")}
                data-testid="msk-dash-create"
              >
                クラスターを作成
              </Button>
            </div>

            <Card title="クラスター" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={clusters}
                rowKey={(c) => c.arn}
                rowTestId="msk-dash-table"
                loading={loading}
                emptyText={
                  <span data-testid="msk-dash-empty">クラスターがありません</span>
                }
                onRowClick={() => navigate("/msk/clusters")}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
