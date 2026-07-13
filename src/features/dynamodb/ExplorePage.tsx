import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, PageResult, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import type { DdbItem } from "../../lib/ddbJson";
import { cellText, columnsOf, keyOf, typedValue } from "./explore";
import { ItemEditorModal } from "./ItemEditorModal";

const PAGE_SIZE = 50;

const CARD = "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
const CARD_HEAD = "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
const INPUT = "rounded-lg border border-[#d9dee3] bg-white px-[10px] py-[6px] text-[13px]";
const BTN = "rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold hover:border-[#5f6b7a]";
const BTN_PRIMARY = "rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab] disabled:cursor-not-allowed disabled:opacity-45";
const BTN_SM = "rounded-md border border-[#d9dee3] bg-white px-[10px] py-[3px] text-[12px] font-semibold hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45";
const BTN_SM_PRIMARY = "rounded-md border border-[#0972d3] bg-[#0972d3] px-[10px] py-[3px] text-[12px] font-semibold text-white hover:bg-[#075bab]";
const KEY_CHIP = "inline-block rounded bg-[#0972d31f] px-2 py-px font-mono text-[11.5px] text-[#0972d3]";

type Mode = "query" | "scan";

export function ExplorePage() {
  const { active } = useConnections();
  const [searchParams, setSearchParams] = useSearchParams();
  const tableParam = searchParams.get("table") ?? "";

  const [tables, setTables] = useState<string[]>([]);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<Mode>("query");
  const [indexName, setIndexName] = useState("");
  const [pkValue, setPkValue] = useState("");
  const [skOp, setSkOp] = useState<"eq" | "begins_with">("begins_with");
  const [skValue, setSkValue] = useState("");
  const [filterAttr, setFilterAttr] = useState("");
  const [filterOp, setFilterOp] = useState<"eq" | "contains">("eq");
  const [filterValue, setFilterValue] = useState("");

  const [page, setPage] = useState<PageResult | null>(null);
  const [keyStack, setKeyStack] = useState<DdbItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editing, setEditing] = useState<{ item: DdbItem | null } | null>(null);

  // Load table list; default ?table= to the first table if unset.
  useEffect(() => {
    if (!active) return;
    void (async () => {
      try {
        const list = await api.ddb.listTables(active);
        setTables(list);
        if (!tableParam && list.length > 0) {
          setSearchParams({ table: list[0] }, { replace: true });
        }
      } catch (e) {
        setError(toAppError(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Describe the selected table.
  useEffect(() => {
    if (!active || !tableParam) {
      setDetail(null);
      return;
    }
    setError(null);
    setIndexName("");
    void (async () => {
      try {
        setDetail(await api.ddb.describeTable(active, tableParam));
      } catch (e) {
        setError(toAppError(e));
      }
    })();
  }, [active, tableParam]);

  const activeKeys = useMemo(() => {
    if (!detail) return [];
    if (!indexName) return detail.keys;
    return detail.gsis.concat(detail.lsis).find((i) => i.name === indexName)?.keys ?? detail.keys;
  }, [detail, indexName]);
  const pkDef = activeKeys.find((k) => k.keyType === "HASH");
  const skDef = activeKeys.find((k) => k.keyType === "RANGE");

  const fetchPage = useCallback(
    async (startKey: DdbItem | null): Promise<PageResult | null> => {
      if (!active || !detail) return null;
      setLoading(true);
      setError(null);
      try {
        if (mode === "scan") {
          const filter =
            filterAttr.trim() && filterValue.trim()
              ? { attr: filterAttr.trim(), op: filterOp, value: { S: filterValue } }
              : null;
          return await api.ddb.scan(active, {
            tableName: detail.name,
            limit: PAGE_SIZE,
            startKey,
            filter,
          });
        }
        if (!pkDef) throw new Error("パーティションキーがありません");
        return await api.ddb.query(active, {
          tableName: detail.name,
          indexName: indexName || null,
          pkName: pkDef.name,
          pkValue: typedValue(pkDef.attrType, pkValue),
          sk:
            skDef && skValue.trim()
              ? { name: skDef.name, op: skOp, value: typedValue(skDef.attrType, skValue) }
              : null,
          limit: PAGE_SIZE,
          startKey,
        });
      } catch (e) {
        setError(toAppError(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [active, detail, mode, filterAttr, filterOp, filterValue, indexName, pkDef, pkValue, skDef, skOp, skValue],
  );

  const run = useCallback(async () => {
    setSelected(new Set());
    setKeyStack([]);
    const p = await fetchPage(null);
    if (p) setPage(p);
  }, [fetchPage]);

  // Auto-run scans when the table changes; query stays explicit (via 実行).
  useEffect(() => {
    if (!detail) return;
    if (mode === "scan") void run();
    else setPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.name, mode]);

  const reloadCurrent = async () => {
    const p = await fetchPage(keyStack.length > 0 ? keyStack[keyStack.length - 1] : null);
    if (p) setPage(p);
    setSelected(new Set());
  };

  const nextPage = async () => {
    if (!page?.lastKey) return;
    const startKey = page.lastKey;
    const p = await fetchPage(startKey);
    if (p) {
      setKeyStack([...keyStack, startKey]);
      setPage(p);
      setSelected(new Set());
    }
  };

  const prevPage = async () => {
    const stack = [...keyStack];
    stack.pop();
    const p = await fetchPage(stack.length > 0 ? stack[stack.length - 1] : null);
    if (p) {
      setKeyStack(stack);
      setPage(p);
      setSelected(new Set());
    }
  };

  const saveItem = async (item: DdbItem) => {
    if (!active || !detail) return;
    await api.ddb.putItem(active, detail.name, item);
    setEditing(null);
    await reloadCurrent();
  };

  const deleteSelected = async () => {
    if (!active || !detail || selected.size === 0) return;
    if (!window.confirm(`選択した ${selected.size} 件のアイテムを削除しますか?`)) return;
    setActionsOpen(false);
    try {
      const items = page?.items ?? [];
      for (const i of selected) {
        const item = items[i];
        if (item) await api.ddb.deleteItem(active, detail.name, keyOf(detail.keys, item));
      }
      await reloadCurrent();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const reset = () => {
    setPkValue("");
    setSkValue("");
    setSkOp("begins_with");
    setFilterAttr("");
    setFilterOp("eq");
    setFilterValue("");
  };

  const items = page?.items ?? [];
  const columns = useMemo(() => (detail ? columnsOf(detail, items) : []), [detail, items]);
  const pkName = detail?.keys.find((k) => k.keyType === "HASH")?.name;
  const pageNumber = keyStack.length + 1;
  const runDisabled = loading || !detail || (mode === "query" && !pkValue.trim());

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold">項目を探索</h1>
        <div className="flex-1" />
        <select
          aria-label="テーブルを選択"
          className={INPUT}
          value={tableParam}
          onChange={(e) => setSearchParams({ table: e.target.value })}
        >
          {tables.length === 0 && <option value="">テーブルなし</option>}
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner error={error} onRetry={run} />

      <div className={`${CARD} overflow-hidden`}>
        <div className={CARD_HEAD}>スキャンまたはクエリ</div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
            <label className="flex items-center gap-[6px] text-[13.5px] font-semibold">
              <input type="radio" name="qmode" checked={mode === "query"} onChange={() => setMode("query")} />
              クエリ
            </label>
            <label className="flex items-center gap-[6px] text-[13.5px] font-semibold">
              <input type="radio" name="qmode" checked={mode === "scan"} onChange={() => setMode("scan")} />
              スキャン
            </label>
            <span className="text-[#5f6b7a]">|</span>
            <select
              aria-label="テーブルまたはインデックス"
              className={INPUT}
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
            >
              <option value="">テーブル - {detail?.name ?? tableParam}</option>
              {detail?.gsis.concat(detail.lsis).map((i) => (
                <option key={i.name} value={i.name}>
                  インデックス - {i.name}
                </option>
              ))}
            </select>
          </div>

          {mode === "query" && (
            <>
              <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
                <span className="mb-[-6px] w-full text-[12px] text-[#5f6b7a]">パーティションキー</span>
                <span className={KEY_CHIP}>
                  {pkDef?.name ?? "pk"} ({pkDef?.attrType ?? "S"})
                </span>
                <select aria-label={`${pkDef?.name ?? "pk"} 条件`} className={INPUT} disabled>
                  <option>=</option>
                </select>
                <input
                  className={`${INPUT} w-[180px] font-mono`}
                  aria-label={`${pkDef?.name ?? "pk"} の値`}
                  value={pkValue}
                  onChange={(e) => setPkValue(e.target.value)}
                />
              </div>
              {skDef && (
                <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
                  <span className="mb-[-6px] w-full text-[12px] text-[#5f6b7a]">ソートキー(任意)</span>
                  <span className={KEY_CHIP}>
                    {skDef.name} ({skDef.attrType})
                  </span>
                  <select
                    aria-label={`${skDef.name} 条件`}
                    className={INPUT}
                    value={skOp}
                    onChange={(e) => setSkOp(e.target.value as typeof skOp)}
                  >
                    <option value="begins_with">次で始まる</option>
                    <option value="eq">=</option>
                  </select>
                  <input
                    className={`${INPUT} w-[180px] font-mono`}
                    aria-label={`${skDef.name} の値`}
                    value={skValue}
                    onChange={(e) => setSkValue(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {mode === "scan" && (
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
              <span className="mb-[-6px] w-full text-[12px] text-[#5f6b7a]">フィルター(任意)</span>
              <input
                className={INPUT}
                placeholder="属性名"
                aria-label="フィルタ属性名"
                value={filterAttr}
                onChange={(e) => setFilterAttr(e.target.value)}
              />
              <select
                aria-label="フィルタ条件"
                className={INPUT}
                value={filterOp}
                onChange={(e) => setFilterOp(e.target.value as typeof filterOp)}
              >
                <option value="eq">=</option>
                <option value="contains">contains</option>
              </select>
              <input
                className={`${INPUT} w-[180px] font-mono`}
                placeholder="値 (文字列)"
                aria-label="フィルタ値"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-[10px]">
            <button onClick={run} disabled={runDisabled} className={BTN_PRIMARY}>
              実行
            </button>
            <button onClick={reset} className={BTN}>
              リセット
            </button>
          </div>
        </div>
      </div>

      <div className={`${CARD} mt-[14px] overflow-hidden`}>
        <div className={CARD_HEAD}>
          返された項目 ({page?.count ?? 0})
          <span className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setActionsOpen((o) => !o)}
              disabled={selected.size === 0}
              className={BTN_SM}
            >
              アクション ▾
            </button>
            {actionsOpen && selected.size > 0 && (
              <div className="absolute right-0 z-10 mt-1 w-32 rounded-md border border-[#d9dee3] bg-white py-1 shadow-lg">
                <button
                  onClick={deleteSelected}
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-[#d13212] hover:bg-[#f5f6f7]"
                >
                  削除
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setEditing({ item: null })} className={BTN_SM_PRIMARY}>
            項目を作成
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="bg-[#f5f6f7] text-[12px] text-[#5f6b7a]">
                <th className="w-8 border-b border-[#d9dee3] px-[14px] py-[9px]" />
                {columns.map((c) => (
                  <th key={c} className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length + 1} className="p-6 text-center text-[#5f6b7a]">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="p-6 text-center text-[#5f6b7a]">
                    {mode === "query" && !page ? "クエリ条件を入力して実行してください" : "アイテムがありません"}
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((item, i) => (
                  <tr key={i} className="hover:bg-[#0972d30d]">
                    <td className="border-b border-[#e9ecef] px-[14px] py-[9px]">
                      <input
                        type="checkbox"
                        aria-label="行を選択"
                        checked={selected.has(i)}
                        onChange={() => toggleRow(i)}
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="max-w-[240px] truncate border-b border-[#e9ecef] px-[14px] py-[9px]">
                        {c === pkName ? (
                          <button
                            onClick={() => setEditing({ item })}
                            className="cursor-pointer font-semibold text-[#0972d3] hover:underline"
                          >
                            {cellText(item, c)}
                          </button>
                        ) : (
                          cellText(item, c)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 border-t border-[#e9ecef] px-4 py-3 text-[12.5px] text-[#5f6b7a]">
          <span>
            {page ? `${page.count} 件表示(スキャン対象 ${page.scannedCount} 件)` : "キー列のリンクから項目を開いて編集できます"}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1">
            <button
              onClick={prevPage}
              disabled={loading || keyStack.length === 0}
              className="rounded px-2 py-0.5 font-bold text-[#0972d3] disabled:cursor-default disabled:text-[#5f6b7a] disabled:opacity-50"
            >
              ◀
            </button>
            <span className="font-bold text-[#16191f]">{pageNumber}</span>
            <button
              onClick={nextPage}
              disabled={loading || !page?.lastKey}
              className="rounded px-2 py-0.5 font-bold text-[#0972d3] disabled:cursor-default disabled:text-[#5f6b7a] disabled:opacity-50"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <ItemEditorModal initial={editing.item} onSubmit={saveItem} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
