import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";

const CARD = "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
const CARD_HEAD = "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
const BTN = "rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold hover:border-[#5f6b7a]";
const BTN_PRIMARY = "rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]";

// Human-readable byte size (B / KB / MB / GB).
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${CARD} px-4 py-4`}>
      <div className="text-[12.5px] font-semibold text-[#5f6b7a]">{label}</div>
      <div className="mt-1 text-[26px] font-bold text-[#16191f] [font-variant-numeric:tabular-nums]">{value}</div>
    </div>
  );
}

export function DashboardPage() {
  const { active } = useConnections();
  const navigate = useNavigate();
  const [details, setDetails] = useState<TableDetail[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const names = await api.ddb.listTables(active);
      const loaded = await Promise.all(names.map((name) => api.ddb.describeTable(active, name)));
      setDetails(loaded);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!active) {
    return (
      <div className="p-6 text-gray-500">
        接続が未登録です。
        <Link to="/connections" className="text-blue-600 underline">
          接続管理
        </Link>
        から登録してください。
      </div>
    );
  }

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold" data-testid="dashboard-heading">
          ダッシュボード
        </h1>
      </div>

      <ErrorBanner error={error} onRetry={load} />

      <div className="mb-[14px] grid grid-cols-1 gap-[14px] sm:grid-cols-3" data-testid="dashboard-summary">
        <SummaryCard label="テーブル数" value={String(details.length)} />
        <SummaryCard label="合計アイテム数" value={totals.items.toLocaleString()} />
        <SummaryCard label="合計サイズ" value={formatBytes(totals.bytes)} />
      </div>

      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <button
          onClick={() => navigate("/dynamodb/tables?create=1")}
          data-testid="dashboard-create-table"
          className={BTN_PRIMARY}
        >
          テーブルを作成
        </button>
        <button
          onClick={() => navigate("/dynamodb/explore")}
          data-testid="dashboard-explore"
          className={BTN}
        >
          項目を探索
        </button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className={CARD_HEAD}>テーブル</div>
        {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
        {!loading && details.length === 0 && !error && (
          <div className="p-8 text-center text-[#5f6b7a]" data-testid="dashboard-empty">
            <p className="mb-3">テーブルがまだありません。</p>
            <Link
              to="/dynamodb/tables?create=1"
              data-testid="dashboard-empty-create"
              className="font-semibold text-[#0972d3] hover:underline"
            >
              最初のテーブルを作成
            </Link>
          </div>
        )}
        {!loading && details.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse [font-variant-numeric:tabular-nums]">
              <thead>
                <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a] [&>th]:whitespace-nowrap">
                  <th>名前</th>
                  <th>ステータス</th>
                  <th>アイテム数</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d) => {
                  const label = d.status === "ACTIVE" ? "アクティブ" : d.status;
                  return (
                    <tr
                      key={d.name}
                      data-testid="dashboard-table-row"
                      onClick={() => navigate(`/dynamodb/tables/${encodeURIComponent(d.name)}`)}
                      className="cursor-pointer [&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] [&>td]:whitespace-nowrap last:[&>td]:border-b-0 hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]"
                    >
                      <td className="font-semibold text-[#0972d3]">{d.name}</td>
                      <td>
                        <span className="text-[12.5px] font-semibold text-[#037f0c]">
                          <span className="mr-1 align-[1px] text-[9px]">●</span>
                          {label}
                        </span>
                      </td>
                      <td>{d.itemCount.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
