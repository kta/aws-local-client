import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { LogGroup } from "../../api/cloudwatch";
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
import { formatBytes } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DashboardData {
  logGroups: LogGroup[];
  // null when the emulator does not support the Metrics/Alarms Query protocol
  // (kumo): the card shows "-" instead of failing the whole dashboard.
  alarmCount: number | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(
    async (profile) => {
      const logGroups = await api.cloudwatch.listLogGroups(profile);
      let alarmCount: number | null = null;
      try {
        alarmCount = (await api.cloudwatch.describeAlarms(profile)).length;
      } catch {
        alarmCount = null;
      }
      return { logGroups, alarmCount };
    },
  );

  const logGroups = useMemo(() => data?.logGroups ?? [], [data]);
  const alarmCount = data?.alarmCount ?? null;

  const columns: Column<LogGroup>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (g) => g.name,
    },
    {
      key: "retention",
      header: "保持期間",
      render: (g) => (g.retentionInDays == null ? "無期限" : `${g.retentionInDays} 日`),
    },
    { key: "size", header: "サイズ", render: (g) => formatBytes(g.storedBytes) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="cloudwatch-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="cw-dash-summary"
            items={[
              {
                label: "ロググループ数",
                value: String(logGroups.length),
                testId: "cw-dash-log-groups",
              },
              {
                label: "アラーム数",
                value: alarmCount == null ? "-" : String(alarmCount),
                testId: "cw-dash-alarms",
              },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/cloudwatch/log-groups?create=1")}
            data-testid="cw-dash-create-lg"
          >
            ロググループを作成
          </Button>
        </div>

        <Card title="ロググループ" overflowHidden>
          <DataTable
            variant="list"
            columns={columns}
            rows={logGroups}
            rowKey={(g) => g.name}
            loading={loading}
            emptyText={error ? undefined : "ロググループがありません"}
            rowTestId="cw-dash-lg-table"
            onRowClick={(g) => navigate(`/cloudwatch/log-groups/${encodeURIComponent(g.name)}`)}
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
