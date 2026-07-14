import { useCallback, useEffect, useMemo, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  card,
  type Column,
  ConnectionRequired,
  cx,
  DataTable,
  input,
} from "../../components/ui";
import { useConnections } from "../../state/connections";
import type { DdbItem } from "../../lib/ddbJson";
import { cellText, columnsOf } from "./explore";

const MAX_COLUMNS = 12;

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

  const columns = useMemo<Column<DdbItem>[]>(
    () =>
      columnsOf(null, items, MAX_COLUMNS).map((c) => ({
        key: c,
        header: c,
        className: "max-w-[240px] truncate",
        render: (item: DdbItem) => cellText(item, c),
      })),
    [items],
  );
  const runDisabled = running || !statement.trim();
  const showSuccess = hasRun && items.length === 0;

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold">PartiQL エディタ</h1>
        </div>

        <ErrorBanner error={error} onRetry={retry} />

        <Card title="ステートメント" overflowHidden>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-[10px]">
              <span className="text-[12px] text-[#5f6b7a]">テンプレート</span>
              <select
                aria-label="テンプレートを選択"
                data-testid="partiql-template-select"
                className={input}
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
              className={`${input} h-32 w-full font-mono`}
              placeholder={'SELECT * FROM "テーブル名"'}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-[10px]">
              <Button variant="primary" onClick={run} disabled={runDisabled} data-testid="partiql-run">
                実行
              </Button>
            </div>
          </div>
        </Card>

        {showSuccess && (
          <div
            data-testid="partiql-success"
            className={cx(card, "mt-[14px] px-4 py-3 text-[13px] text-[#037f51]")}
          >
            ステートメントを実行しました(結果 0 件)
          </div>
        )}

        {items.length > 0 && (
          <Card
            overflowHidden
            className="mt-[14px]"
            title={<span data-testid="partiql-count">結果 ({items.length})</span>}
          >
            <div data-testid="partiql-results">
              <DataTable
                variant="results"
                columns={columns}
                rows={items}
                rowKey={(_, i) => String(i)}
                rowTestId="partiql-row"
              />
            </div>
            {nextToken && (
              <div className="flex items-center border-t border-[#e9ecef] px-4 py-3">
                <Button onClick={loadMore} disabled={running} data-testid="partiql-load-more">
                  さらに読み込む
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </ConnectionRequired>
  );
}
