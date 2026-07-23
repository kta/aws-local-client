import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { EventBusSummary } from "../../api/eventbridge";
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

interface DashboardData {
  buses: EventBusSummary[];
  ruleCount: number;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const buses = await api.eventbridge.listBuses(profile);
    // Rule count is the sum across every bus; best-effort per bus so one bus
    // failing to list does not blank the whole card.
    let ruleCount = 0;
    for (const bus of buses) {
      try {
        ruleCount += (await api.eventbridge.listRules(profile, bus.name)).length;
      } catch {
        /* skip a bus that fails to list */
      }
    }
    return { buses, ruleCount };
  });

  const buses = useMemo(() => data?.buses ?? [], [data]);
  const ruleCount = data?.ruleCount ?? 0;

  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const columns: Column<EventBusSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (b) => b.name,
    },
    {
      key: "arn",
      header: "ARN",
      render: (b) => <span className="font-mono text-xs text-[#5f6b7a]">{b.arn ?? "-"}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="eb-dashboard-heading" />

        {unsupported && (
          <div
            data-testid="eventbridge-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは EventBridge API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="eb-dash-summary"
                items={[
                  { label: "イベントバス数", value: String(buses.length), testId: "eb-dash-buses" },
                  { label: "ルール数", value: String(ruleCount), testId: "eb-dash-rules" },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/eventbridge/buses?create=1")}
                data-testid="eb-dash-create"
              >
                イベントバスを作成
              </Button>
            </div>

            <Card title="イベントバス" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={buses}
                rowKey={(b) => b.name}
                loading={loading}
                emptyText={error ? undefined : "イベントバスがありません"}
                rowTestId="eb-dash-table"
                onRowClick={() => navigate("/eventbridge/buses")}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
