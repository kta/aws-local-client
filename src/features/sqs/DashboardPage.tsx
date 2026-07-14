import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { QueueSummary } from "../../api/sqs";
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
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<QueueSummary[]>((profile) =>
    api.sqs.listQueues(profile),
  );
  const queues = useMemo(() => data ?? [], [data]);

  const totals = useMemo(() => {
    return queues.reduce(
      (acc, q) => {
        acc.visible += q.approximateMessages;
        acc.inflight += q.approximateNotVisible;
        if (q.fifo) acc.fifo += 1;
        return acc;
      },
      { visible: 0, inflight: 0, fifo: 0 },
    );
  }, [queues]);

  const columns: Column<QueueSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (q) => q.name,
    },
    {
      key: "type",
      header: "種別",
      render: (q) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {q.fifo ? "FIFO" : "Standard"}
        </span>
      ),
    },
    { key: "messages", header: "メッセージ数(概算)", render: (q) => q.approximateMessages.toLocaleString() },
    { key: "inflight", header: "処理中(概算)", render: (q) => q.approximateNotVisible.toLocaleString() },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="sqs-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="sqs-dash-summary"
            items={[
              { label: "キュー数", value: String(queues.length), testId: "sqs-dash-queues" },
              {
                label: "可視メッセージ数(概算)",
                value: totals.visible.toLocaleString(),
                testId: "sqs-dash-visible",
              },
              {
                label: "処理中メッセージ数(概算)",
                value: totals.inflight.toLocaleString(),
                testId: "sqs-dash-inflight",
              },
              { label: "FIFO キュー数", value: String(totals.fifo), testId: "sqs-dash-fifo" },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/sqs/queues?create=1")}
            data-testid="sqs-dash-create"
          >
            キューを作成
          </Button>
        </div>

        <Card title="キュー" overflowHidden>
          <DataTable
            variant="list"
            columns={columns}
            rows={queues}
            rowKey={(q) => q.name}
            loading={loading}
            emptyText={error ? undefined : "キューがありません"}
            rowTestId="sqs-dash-table"
            onRowClick={(q) => navigate(`/sqs/queues/${encodeURIComponent(q.name)}`)}
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
