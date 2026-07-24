import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { CfnExport, CfnStackSummary } from "../../api/cloudformation";
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
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DashboardData {
  stacks: CfnStackSummary[];
  // null when ListExports is unsupported by this emulator (kumo). Best-effort.
  exports: CfnExport[] | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const stacks = await api.cloudformation.listStacks(profile);
    // Exports are best-effort: an unsupported error yields a hidden section but
    // must not fail the whole dashboard.
    let exports: CfnExport[] | null = null;
    try {
      exports = await api.cloudformation.listExports(profile);
    } catch {
      exports = null;
    }
    return { stacks, exports };
  });

  const stacks = useMemo(() => data?.stacks ?? [], [data]);
  const exports = data?.exports ?? null;

  const completeCount = stacks.filter((s) => s.status.endsWith("_COMPLETE")).length;
  const failedCount = stacks.filter((s) => s.status.endsWith("_FAILED")).length;

  const columns: Column<CfnStackSummary>[] = [
    {
      key: "name",
      header: "スタック名",
      className: "font-semibold text-[#0972d3]",
      render: (s) => s.name,
    },
    {
      key: "status",
      header: "ステータス",
      render: (s) => <StatusBadge status={s.status} />,
    },
    { key: "createdAt", header: "作成日時", render: (s) => formatDate(s.createdAt) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="cfn-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="cfn-dash-summary"
            items={[
              { label: "スタック数", value: String(stacks.length), testId: "cfn-dash-stacks" },
              { label: "完了", value: String(completeCount), testId: "cfn-dash-complete" },
              { label: "失敗", value: String(failedCount), testId: "cfn-dash-failed" },
              {
                label: "エクスポート数",
                value: exports == null ? "-" : String(exports.length),
                testId: "cfn-dash-exports",
              },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/cloudformation/stacks?create=1")}
            data-testid="cfn-dash-create"
          >
            スタックを作成
          </Button>
        </div>

        <Card title="スタック" overflowHidden>
          <DataTable
            variant="list"
            columns={columns}
            rows={stacks}
            rowKey={(s) => s.name}
            loading={loading}
            emptyText={error ? undefined : "スタックがありません"}
            rowTestId="cfn-dash-table"
            onRowClick={(s) =>
              navigate(`/cloudformation/stacks/${encodeURIComponent(s.name)}`)
            }
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
