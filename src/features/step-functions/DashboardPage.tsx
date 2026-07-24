import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { StateMachineSummary } from "../../api/stepfunctions";
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
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<StateMachineSummary[]>((profile) =>
    api.stepfunctions.listStateMachines(profile),
  );
  const machines = useMemo(() => data ?? [], [data]);

  // An unsupported describe takes over the whole page with the shared banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const standardCount = machines.filter((m) => m.type === "STANDARD").length;
  const expressCount = machines.filter((m) => m.type === "EXPRESS").length;

  const columns: Column<StateMachineSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (m) => m.name,
    },
    { key: "type", header: "タイプ", render: (m) => m.type },
    { key: "createdAt", header: "作成日時", render: (m) => formatDate(m.createdAt) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="step-functions-dashboard-heading" />

        {unsupported && (
          <div
            data-testid="step-functions-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは Step Functions API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="step-functions-dash-summary"
                items={[
                  {
                    label: "ステートマシン数",
                    value: String(machines.length),
                    testId: "sfn-dash-machines",
                  },
                  { label: "Standard", value: String(standardCount), testId: "sfn-dash-standard" },
                  { label: "Express", value: String(expressCount), testId: "sfn-dash-express" },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/step-functions/state-machines?create=1")}
                data-testid="sfn-dash-create"
              >
                ステートマシンを作成
              </Button>
            </div>

            <Card title="ステートマシン" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={machines}
                rowKey={(m) => m.name}
                loading={loading}
                emptyText={error ? undefined : "ステートマシンがありません"}
                rowTestId="sfn-dash-table"
                onRowClick={(m) =>
                  navigate(`/step-functions/state-machines/${encodeURIComponent(m.name)}`)
                }
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
