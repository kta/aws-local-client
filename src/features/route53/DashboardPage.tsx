import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { HostedZoneSummary } from "../../api/route53";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  EmptyState,
  PageHeader,
  SummaryCards,
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DashboardData {
  zones: HostedZoneSummary[];
  // null when the emulator does not implement health checks (card shows "-").
  healthCheckCount: number | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const zones = await api.route53.listHostedZones(profile);
    let healthCheckCount: number | null = null;
    try {
      healthCheckCount = (await api.route53.listHealthChecks(profile)).length;
    } catch {
      healthCheckCount = null;
    }
    return { zones, healthCheckCount };
  });

  const zones = useMemo(() => data?.zones ?? [], [data]);
  const healthCheckCount = data?.healthCheckCount ?? null;

  const columns: Column<HostedZoneSummary>[] = [
    {
      key: "name",
      header: "ドメイン名",
      className: "font-semibold text-[#0972d3]",
      render: (z) => z.name,
    },
    {
      key: "type",
      header: "タイプ",
      render: (z) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {z.privateZone ? "プライベート" : "パブリック"}
        </span>
      ),
    },
    {
      key: "records",
      header: "レコード数",
      render: (z) => z.recordCount.toLocaleString(),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="route53-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="route53-dash-summary"
            items={[
              { label: "ホストゾーン数", value: String(zones.length), testId: "route53-dash-zones" },
              {
                label: "ヘルスチェック数",
                value: healthCheckCount == null ? "-" : String(healthCheckCount),
                testId: "route53-dash-healthchecks",
              },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/route53/hosted-zones?create=1")}
            data-testid="route53-dash-create-zone"
          >
            ホストゾーンを作成
          </Button>
          <Button
            onClick={() => navigate("/route53/health-checks")}
            data-testid="route53-dash-healthchecks-link"
          >
            ヘルスチェック
          </Button>
        </div>

        <Card title="ホストゾーン" overflowHidden>
          {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
          {!loading && zones.length === 0 && !error && (
            <EmptyState
              testId="route53-dash-empty"
              message="ホストゾーンがまだありません。"
              action={
                <Link
                  to="/route53/hosted-zones?create=1"
                  data-testid="route53-dash-empty-create"
                  className="font-semibold text-[#0972d3] hover:underline"
                >
                  最初のホストゾーンを作成
                </Link>
              }
            />
          )}
          {!loading && zones.length > 0 && (
            <div data-testid="route53-dash-table">
              <DataTable
                variant="list"
                columns={columns}
                rows={zones}
                rowKey={(z) => z.id}
                rowTestId="route53-dash-table-row"
                onRowClick={(z) =>
                  navigate(`/route53/hosted-zones/${encodeURIComponent(z.id)}`)
                }
              />
            </div>
          )}
        </Card>
      </div>
    </ConnectionRequired>
  );
}
