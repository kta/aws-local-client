import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { GlobalSubscription, TopicSummary } from "../../api/sns";
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
  topics: TopicSummary[];
  subscriptions: GlobalSubscription[];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const [topics, subscriptions] = await Promise.all([
      api.sns.listTopics(profile),
      api.sns.listAllSubscriptions(profile),
    ]);
    return { topics, subscriptions };
  });
  const topics = useMemo(() => data?.topics ?? [], [data]);
  const subscriptions = useMemo(() => data?.subscriptions ?? [], [data]);
  const fifoCount = useMemo(() => topics.filter((t) => t.fifo).length, [topics]);

  const columns: Column<TopicSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (t) => t.name,
    },
    {
      key: "type",
      header: "種別",
      render: (t) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {t.fifo ? "FIFO" : "Standard"}
        </span>
      ),
    },
    {
      key: "arn",
      header: "ARN",
      render: (t) => <span className="font-mono text-[12px] text-[#5f6b7a]">{t.topicArn}</span>,
    },
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
              { label: "トピック数", value: String(topics.length), testId: "sns-dash-topics" },
              {
                label: "サブスクリプション総数",
                value: String(subscriptions.length),
                testId: "sns-dash-subs",
              },
              { label: "FIFO トピック数", value: String(fifoCount), testId: "sns-dash-fifo" },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/sns/topics?create=1")}
            data-testid="sns-dash-create"
          >
            トピックを作成
          </Button>
          <Button onClick={() => navigate("/sns/subscriptions")} data-testid="sns-dash-subs-link">
            サブスクリプション
          </Button>
        </div>

        <Card title="トピック" overflowHidden>
          {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
          {!loading && topics.length === 0 && !error && (
            <EmptyState
              testId="sns-dash-empty"
              message="トピックがまだありません。"
              action={
                <Link
                  to="/sns/topics?create=1"
                  data-testid="sns-dash-empty-create"
                  className="font-semibold text-[#0972d3] hover:underline"
                >
                  最初のトピックを作成
                </Link>
              }
            />
          )}
          {!loading && topics.length > 0 && (
            <div data-testid="sns-dash-table">
              <DataTable
                variant="list"
                columns={columns}
                rows={topics}
                rowKey={(t) => t.name}
                rowTestId="sns-dash-table-row"
                onRowClick={(t) => navigate(`/sns/topics/${encodeURIComponent(t.name)}`)}
              />
            </div>
          )}
        </Card>
      </div>
    </ConnectionRequired>
  );
}
