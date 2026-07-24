import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { ApiSummary } from "../../api/apigateway";
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
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DashboardData {
  apis: ApiSummary[];
  // null when the API-key API is unsupported by this emulator (card shows "-").
  keyCount: number | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(
    async (profile) => {
      const apis = await api.apigateway.listApis(profile);
      // The API-key count is best-effort: an unsupported error yields "-" but
      // must not fail the whole dashboard.
      let keyCount: number | null = null;
      try {
        keyCount = (await api.apigateway.listApiKeys(profile)).length;
      } catch {
        keyCount = null;
      }
      return { apis, keyCount };
    },
  );

  const apis = useMemo(() => data?.apis ?? [], [data]);
  const keyCount = data?.keyCount ?? null;

  const columns: Column<ApiSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (a) => a.name,
    },
    { key: "id", header: "ID", render: (a) => <span className="font-mono text-xs">{a.id}</span> },
    { key: "createdDate", header: "作成日時", render: (a) => formatDate(a.createdDate) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="apigw-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="apigw-dash-summary"
            items={[
              { label: "API 数", value: String(apis.length), testId: "apigw-dash-apis" },
              {
                label: "API キー数",
                value: keyCount == null ? "-" : String(keyCount),
                testId: "apigw-dash-keys",
              },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/api-gateway/apis?create=1")}
            data-testid="apigw-dash-create"
          >
            API を作成
          </Button>
        </div>

        <Card title="API" overflowHidden>
          <DataTable
            variant="list"
            columns={columns}
            rows={apis}
            rowKey={(a) => a.id}
            loading={loading}
            emptyText={error ? undefined : "API がありません"}
            rowTestId="apigw-dash-table"
            onRowClick={(a) => navigate(`/api-gateway/apis/${encodeURIComponent(a.id)}`)}
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
