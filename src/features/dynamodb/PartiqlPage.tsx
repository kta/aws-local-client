import { useCallback, useEffect, useMemo, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import type { DdbItem } from "../../lib/ddbJson";
import { ddbToPlain } from "../../lib/ddbJson";

const CARD = "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
const CARD_HEAD = "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
const INPUT = "rounded-lg border border-[#d9dee3] bg-white px-[10px] py-[6px] text-[13px]";
const BTN = "rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45";
const BTN_PRIMARY = "rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab] disabled:cursor-not-allowed disabled:opacity-45";

const MAX_COLUMNS = 12;

/** Union of keys across items, preserving first-seen order, capped at MAX_COLUMNS. */
function columnsOf(items: DdbItem[]): string[] {
  const cols: string[] = [];
  for (const item of items) {
    for (const k of Object.keys(item)) {
      if (!cols.includes(k)) cols.push(k);
    }
  }
  return cols.slice(0, MAX_COLUMNS);
}

/** Render a single cell as display text (objects/arrays are JSON-stringified). */
function cellText(item: DdbItem, col: string): string {
  const v = item[col];
  if (v === undefined) return "";
  const plain = ddbToPlain(v);
  return typeof plain === "object" && plain !== null ? JSON.stringify(plain) : String(plain);
}

export function PartiqlPage() {
  const { active } = useConnections();

  const [tables, setTables] = useState<string[]>([]);
  const [statement, setStatement] = useState("");
  // The statement actually executed by the last run; loadMore must reuse this
  // (not the live textarea value) so its nextToken stays paired with its query.
  const [executedStatement, setExecutedStatement] = useState("");
  const [items, setItems] = useState<DdbItem[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  // Which operation produced the current error, so retry can redo the right thing.
  const [errorSource, setErrorSource] = useState<"tables" | "run" | null>(null);
  const [running, setRunning] = useState(false);

  const loadTables = useCallback(async () => {
    if (!active) return;
    try {
      setTables(await api.ddb.listTables(active));
    } catch (e) {
      setError(toAppError(e));
      setErrorSource("tables");
    }
  }, [active]);

  // Load table list for the template helper.
  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  // Clear stale results/errors when the active connection changes; keep the
  // statement text (user input).
  useEffect(() => {
    setItems([]);
    setNextToken(undefined);
    setExecutedStatement("");
    setHasRun(false);
    setError(null);
    setErrorSource(null);
  }, [active]);

  const run = useCallback(async () => {
    if (!active || !statement.trim()) return;
    setRunning(true);
    setError(null);
    setErrorSource(null);
    // New run clears previous results.
    setItems([]);
    setNextToken(undefined);
    setHasRun(false);
    try {
      const res = await api.ddb.executeStatement(active, statement);
      setItems(res.items);
      setNextToken(res.nextToken);
      setExecutedStatement(statement);
      setHasRun(true);
    } catch (e) {
      setError(toAppError(e));
      setErrorSource("run");
    } finally {
      setRunning(false);
    }
  }, [active, statement]);

  const loadMore = useCallback(async () => {
    if (!active || !nextToken) return;
    setRunning(true);
    setError(null);
    setErrorSource(null);
    try {
      const res = await api.ddb.executeStatement(active, executedStatement, nextToken);
      setItems((prev) => [...prev, ...res.items]);
      setNextToken(res.nextToken);
    } catch (e) {
      setError(toAppError(e));
      setErrorSource("run");
    } finally {
      setRunning(false);
    }
  }, [active, executedStatement, nextToken]);

  // Retry redoes whatever failed: a table-list load or a statement run.
  const retry = useCallback(() => {
    if (errorSource === "tables") {
      setError(null);
      setErrorSource(null);
      void loadTables();
    } else {
      void run();
    }
  }, [errorSource, loadTables, run]);

  const onTemplate = (table: string) => {
    if (!table) return;
    setStatement(`SELECT * FROM "${table}"`);
  };

  const columns = useMemo(() => columnsOf(items), [items]);
  const runDisabled = running || !statement.trim();
  const showSuccess = hasRun && items.length === 0;

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold">PartiQL エディタ</h1>
      </div>

      <ErrorBanner error={error} onRetry={retry} />

      <div className={`${CARD} overflow-hidden`}>
        <div className={CARD_HEAD}>ステートメント</div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-[10px]">
            <span className="text-[12px] text-[#5f6b7a]">テンプレート</span>
            <select
              aria-label="テンプレートを選択"
              data-testid="partiql-template-select"
              className={INPUT}
              value=""
              onChange={(e) => onTemplate(e.target.value)}
            >
              <option value="">テーブルを選択...</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <textarea
            data-testid="partiql-statement"
            aria-label="PartiQL ステートメント"
            className={`${INPUT} h-32 w-full font-mono`}
            placeholder={'SELECT * FROM "テーブル名"'}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-[10px]">
            <button onClick={run} disabled={runDisabled} data-testid="partiql-run" className={BTN_PRIMARY}>
              実行
            </button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <div
          data-testid="partiql-success"
          className={`${CARD} mt-[14px] px-4 py-3 text-[13px] text-[#037f51]`}
        >
          ステートメントを実行しました(結果 0 件)
        </div>
      )}

      {items.length > 0 && (
        <div className={`${CARD} mt-[14px] overflow-hidden`}>
          <div className={CARD_HEAD}>
            <span data-testid="partiql-count">結果 ({items.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table data-testid="partiql-results" className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="bg-[#f5f6f7] text-[12px] text-[#5f6b7a]">
                  {columns.map((c) => (
                    <th key={c} className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} data-testid="partiql-row" className="hover:bg-[#0972d30d]">
                    {columns.map((c) => (
                      <td key={c} className="max-w-[240px] truncate border-b border-[#e9ecef] px-[14px] py-[9px]">
                        {cellText(item, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextToken && (
            <div className="flex items-center border-t border-[#e9ecef] px-4 py-3">
              <button onClick={loadMore} disabled={running} data-testid="partiql-load-more" className={BTN}>
                さらに読み込む
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
