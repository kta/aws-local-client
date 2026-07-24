import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { FunctionSummary } from "../../api/lambda";
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
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DashboardData {
  functions: FunctionSummary[];
  // null when the emulator does not implement the layers API (e.g. kumo).
  layerCount: number | null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useProfileScopedFetch<DashboardData>(
    async (profile) => {
      const functions = await api.lambda.listFunctions(profile);
      let layerCount: number | null = null;
      try {
        layerCount = (await api.lambda.listLayers(profile)).length;
      } catch {
        // Best-effort: an unsupported layers API yields "-" without failing.
        layerCount = null;
      }
      return { functions, layerCount };
    },
  );

  const functions = useMemo(() => data?.functions ?? [], [data]);
  const layerCount = data?.layerCount ?? null;
  const totalCodeSize = useMemo(
    () => functions.reduce((acc, f) => acc + f.codeSize, 0),
    [functions],
  );

  const columns: Column<FunctionSummary>[] = [
    {
      key: "name",
      header: "関数名",
      className: "font-semibold text-[#0972d3]",
      render: (f) => f.name,
    },
    { key: "runtime", header: "ランタイム", render: (f) => f.runtime ?? "-" },
    { key: "handler", header: "ハンドラ", render: (f) => f.handler ?? "-" },
    { key: "lastModified", header: "更新日時", render: (f) => formatDate(f.lastModified) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="lambda-dashboard-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-[14px]">
          <SummaryCards
            testId="lambda-dash-summary"
            items={[
              {
                label: "関数数",
                value: String(functions.length),
                testId: "lambda-dash-functions",
              },
              {
                label: "レイヤー数",
                value: layerCount == null ? "-" : String(layerCount),
                testId: "lambda-dash-layers",
              },
              {
                label: "合計コードサイズ",
                value: formatBytes(totalCodeSize),
                testId: "lambda-dash-codesize",
              },
            ]}
          />
        </div>

        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          <Button
            variant="primary"
            onClick={() => navigate("/lambda/functions?create=1")}
            data-testid="lambda-dash-create"
          >
            関数を作成
          </Button>
        </div>

        <Card title="関数" overflowHidden>
          <DataTable
            variant="list"
            columns={columns}
            rows={functions}
            rowKey={(f) => f.name}
            loading={loading}
            emptyText={error ? undefined : "関数がありません"}
            rowTestId="lambda-dash-table"
            onRowClick={(f) => navigate(`/lambda/functions/${encodeURIComponent(f.name)}`)}
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
