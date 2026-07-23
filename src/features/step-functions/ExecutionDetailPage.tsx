import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ExecutionDetail, HistoryEvent } from "../../api/stepfunctions";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Card, ConnectionRequired } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useConnections } from "../../state/connections";

/** Pretty-print a JSON string for display, leaving non-JSON untouched. */
function prettyJson(raw: string | null): string {
  if (raw == null) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ExecutionDetailPage() {
  const { arn } = useParams<{ arn: string }>();
  const executionArn = arn ? decodeURIComponent(arn) : "";
  const { active } = useConnections();

  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!active || !executionArn) return;
    try {
      const d = await api.stepfunctions.describeExecution(active, executionArn);
      setDetail(d);
      setError(null);
      try {
        setHistory(await api.stepfunctions.getExecutionHistory(active, executionArn));
      } catch {
        // History can be unavailable while the execution is still starting;
        // keep the last snapshot rather than surfacing a transient error.
      }
      // Poll until the execution reaches a terminal state.
      if (d.status === "RUNNING") {
        timer.current = setTimeout(() => void load(), 1500);
      }
    } catch (e) {
      setError(toAppError(e));
    }
  }, [active, executionArn]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link
            to="/step-functions/state-machines"
            className="font-semibold text-[#0972d3] hover:underline"
          >
            ステートマシン
          </Link>
          {" / 実行"}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="execution-heading">
            {detail?.name ?? "実行"}
          </h1>
          {detail && (
            <span
              data-testid="exec-status"
              className="text-[12.5px] font-semibold text-[#5f6b7a]"
            >
              {detail.status}
            </span>
          )}
        </div>

        <ErrorBanner error={error} onRetry={load} />

        {detail && (
          <>
            <Card title="概要" overflowHidden>
              <div className="space-y-1 p-4 text-[13px]">
                <div>
                  <span className="text-gray-600">実行 ARN: </span>
                  <span className="font-mono text-xs">{detail.executionArn}</span>
                </div>
                <div>
                  <span className="text-gray-600">開始: </span>
                  {formatDate(detail.startedAt)}
                  <span className="ml-3 text-gray-600">終了: </span>
                  {formatDate(detail.stoppedAt)}
                </div>
              </div>
            </Card>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card title="入力" overflowHidden>
                <pre
                  data-testid="exec-input-display"
                  className="max-h-64 overflow-auto p-4 font-mono text-xs text-[#16191f]"
                >
                  {prettyJson(detail.input)}
                </pre>
              </Card>
              <Card title="出力" overflowHidden>
                <pre
                  data-testid="exec-output-display"
                  className="max-h-64 overflow-auto p-4 font-mono text-xs text-[#16191f]"
                >
                  {prettyJson(detail.output)}
                </pre>
              </Card>
            </div>

            <div className="mt-4">
              <Card title="イベント履歴" overflowHidden>
                <table
                  data-testid="exec-history-table"
                  className="w-full border-collapse [font-variant-numeric:tabular-nums]"
                >
                  <thead>
                    <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                      <th className="w-12">ID</th>
                      <th>イベントタイプ</th>
                      <th>タイムスタンプ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                          イベントがありません。
                        </td>
                      </tr>
                    )}
                    {history.map((ev) => (
                      <tr
                        key={ev.id}
                        data-testid={`history-row-${ev.id}`}
                        className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
                      >
                        <td className="font-mono text-xs">{ev.id}</td>
                        <td className="text-xs">{ev.eventType}</td>
                        <td className="text-xs text-[#5f6b7a]">{formatDate(ev.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
