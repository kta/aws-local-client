import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { TableDetail } from "../../api/types";
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
import { formatBytes } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<TableDetail[]>(async (profile) => {
    const names = await api.ddb.listTables(profile);
    return Promise.all(names.map((name) => api.ddb.describeTable(profile, name)));
  });
  const details = useMemo(() => data ?? [], [data]);

  const totals = useMemo(() => {
    return details.reduce(
      (acc, d) => {
        acc.items += d.itemCount;
        acc.bytes += d.sizeBytes;
        return acc;
      },
      { items: 0, bytes: 0 },
    );
  }, [details]);

  const columns: Column<TableDetail>[] = [
    { key: "name", header: "名前", className: "font-semibold text-[#0972d3]", render: (d) => d.name },
    {
      key: "status",
      header: "ステータス",
      render: (d) => {
        const label = d.status === "ACTIVE" ? "アクティブ" : d.status;
        return (
          <span className="text-[12.5px] font-semibold text-[#037f0c]">
            <span className="mr-1 align-[1px] text-[9px]">●</span>
            {label}
          </span>
        );
      },
    },
    { key: "itemCount", header: "アイテム数", render: (d) => d.itemCount.toLocaleString() },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="dashboard-summary"
            items={[
              { label: "テーブル数", value: String(details.length) },
              { label: "合計アイテム数", value: totals.items.toLocaleString() },
              { label: "合計サイズ", value: formatBytes(totals.bytes) },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/dynamodb/tables?create=1")}
            data-testid="dashboard-create-table"
          >
            テーブルを作成
          </Button>
          <Button onClick={() => navigate("/dynamodb/explore")} data-testid="dashboard-explore">
            項目を探索
          </Button>
        </div>

        <Card title="テーブル" overflowHidden>
          {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
          {!loading && details.length === 0 && !error && (
            <EmptyState
              testId="dashboard-empty"
              message="テーブルがまだありません。"
              action={
                <Link
                  to="/dynamodb/tables?create=1"
                  data-testid="dashboard-empty-create"
                  className="font-semibold text-[#0972d3] hover:underline"
                >
                  最初のテーブルを作成
                </Link>
              }
            />
          )}
          {!loading && details.length > 0 && (
            <DataTable
              variant="list"
              columns={columns}
              rows={details}
              rowKey={(d) => d.name}
              rowTestId="dashboard-table-row"
              onRowClick={(d) => navigate(`/dynamodb/tables/${encodeURIComponent(d.name)}`)}
            />
          )}
        </Card>
      </div>
    </ConnectionRequired>
  );
}
