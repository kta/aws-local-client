import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { DomainSummary } from "../../api/opensearch";
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
import { domainStatusLabel } from "./status";
import { UnsupportedBanner } from "./UnsupportedBanner";

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DomainSummary[]>((profile) => api.opensearch.listDomains(profile));

  const domains = useMemo(() => data ?? [], [data]);

  // R88: an unsupported describe takes over the whole page with the shared
  // opensearch-unsupported banner; other errors stay a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const activeCount = domains.filter((d) => d.created && !d.processing).length;

  const columns: Column<DomainSummary>[] = [
    {
      key: "name",
      header: "ドメイン名",
      className: "font-semibold text-[#0972d3]",
      render: (d) => d.name,
    },
    { key: "engineVersion", header: "エンジンバージョン", render: (d) => d.engineVersion ?? "-" },
    {
      key: "status",
      header: "ステータス",
      render: (d) => <StatusBadge status={domainStatusLabel(d)} />,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="opensearch-dashboard-heading" />

        {unsupported && <UnsupportedBanner error={unsupported} />}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="opensearch-dashboard-summary"
                items={[
                  {
                    label: "ドメイン数",
                    value: String(domains.length),
                    testId: "opensearch-dash-domains",
                  },
                  {
                    label: "アクティブ",
                    value: String(activeCount),
                    testId: "opensearch-dash-active",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/opensearch/domains?create=1")}
                data-testid="opensearch-dash-create"
              >
                ドメインを作成
              </Button>
            </div>

            <Card title="ドメイン" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={domains}
                rowKey={(d) => d.name}
                rowTestId="opensearch-dash-table"
                loading={loading}
                emptyText={<span data-testid="opensearch-dash-empty">ドメインがありません</span>}
                onRowClick={() => navigate("/opensearch/domains")}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
