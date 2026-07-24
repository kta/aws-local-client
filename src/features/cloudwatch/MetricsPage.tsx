import { useEffect, useMemo, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { Datapoint, MetricSummary } from "../../api/cloudwatch";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

const STATS = ["Average", "Sum", "Maximum", "Minimum", "SampleCount"];

/** Uniquely identify a metric (namespace + name + sorted dimensions). */
function metricKey(m: MetricSummary): string {
  const dims = [...m.dimensions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => `${d.name}=${d.value}`)
    .join(",");
  return `${m.namespace}|${m.name}|${dims}`;
}

export function MetricsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<MetricSummary[]>((profile) => api.cloudwatch.listMetrics(profile));
  const metrics = useMemo(() => data ?? [], [data]);

  const [namespace, setNamespace] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [stat, setStat] = useState("Average");
  const [points, setPoints] = useState<Datapoint[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statError, setStatError] = useState<AppError | null>(null);

  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const error = fetchError && !unsupported ? fetchError : null;

  const namespaces = useMemo(
    () => [...new Set(metrics.map((m) => m.namespace))].sort(),
    [metrics],
  );

  // Default the namespace selector to the first namespace once metrics load.
  useEffect(() => {
    if (!namespace && namespaces.length > 0) setNamespace(namespaces[0]);
  }, [namespaces, namespace]);

  const namespaceMetrics = useMemo(
    () => metrics.filter((m) => m.namespace === namespace),
    [metrics, namespace],
  );

  const selectedMetric = useMemo(
    () => metrics.find((m) => metricKey(m) === selectedKey) ?? null,
    [metrics, selectedKey],
  );

  // Load statistics whenever the selected metric or statistic changes.
  useEffect(() => {
    if (!active || !selectedMetric) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    // End a few minutes in the future so the newest datapoint — in the current
    // partial period, or timestamped slightly ahead by emulator clock skew — is
    // not excluded by a strict EndTime (localstack drops it; real data is always
    // in the past, so the buffer is harmless).
    const end = new Date(Date.now() + 5 * 60 * 1000);
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000); // last 3 hours
    setStatsLoading(true);
    setStatError(null);
    api.cloudwatch
      .getMetricStatistics(active, {
        namespace: selectedMetric.namespace,
        metricName: selectedMetric.name,
        dimensions: selectedMetric.dimensions,
        periodSec: 60,
        stat,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
      })
      .then((p) => {
        if (!cancelled) setPoints(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setStatError(toAppError(e));
          setPoints([]);
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, selectedMetric, stat]);

  const metricColumns: Column<MetricSummary>[] = [
    {
      key: "name",
      header: "メトリクス名",
      render: (m) => (
        <button
          type="button"
          data-testid={`metric-link-${m.name}`}
          onClick={() => setSelectedKey(metricKey(m))}
          className="font-semibold text-[#0972d3] hover:underline"
        >
          {m.name}
        </button>
      ),
    },
    {
      key: "dims",
      header: "ディメンション",
      render: (m) =>
        m.dimensions.length === 0
          ? "-"
          : m.dimensions.map((d) => `${d.name}=${d.value}`).join(", "),
    },
  ];

  const pointColumns: Column<Datapoint>[] = [
    { key: "ts", header: "タイムスタンプ", render: (p) => formatDate(p.timestamp) },
    {
      key: "value",
      header: "値",
      className: "[font-variant-numeric:tabular-nums]",
      render: (p) => p.value.toLocaleString(),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="メトリクス" titleTestId="metrics-heading" />

        {unsupported && (
          <div
            data-testid="cloudwatch-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは CloudWatch メトリクスをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: localstack、floci、ministack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[12px] flex flex-wrap items-end gap-[10px]">
              <label className="block text-sm">
                <span className="text-gray-600">名前空間</span>
                <select
                  className="mt-1 block w-[240px] rounded border border-gray-300 px-2 py-1"
                  data-testid="metrics-namespace-select"
                  value={namespace}
                  onChange={(e) => {
                    setNamespace(e.target.value);
                    setSelectedKey(null);
                  }}
                >
                  {namespaces.length === 0 && <option value="">(名前空間なし)</option>}
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-gray-600">統計</span>
                <select
                  className="mt-1 block w-[160px] rounded border border-gray-300 px-2 py-1"
                  data-testid="metrics-stat-select"
                  value={stat}
                  onChange={(e) => setStat(e.target.value)}
                >
                  {STATS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mb-[14px]">
              <Card title="メトリクス" overflowHidden>
                <DataTable
                  variant="list"
                  columns={metricColumns}
                  rows={namespaceMetrics}
                  rowKey={(m) => metricKey(m)}
                  loading={loading}
                  emptyText={error ? undefined : "メトリクスがありません"}
                  rowTestId="metric-row"
                />
              </Card>
            </div>

            <ErrorBanner error={statError} />

            <Card
              title={selectedMetric ? `統計: ${selectedMetric.name}` : "統計"}
              overflowHidden
            >
              <DataTable
                variant="list"
                columns={pointColumns}
                rows={points}
                rowKey={(_, i) => String(i)}
                loading={statsLoading}
                emptyText={
                  selectedMetric ? "データポイントがありません" : "メトリクスを選択してください"
                }
                rowTestId="metric-datapoint-row"
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
