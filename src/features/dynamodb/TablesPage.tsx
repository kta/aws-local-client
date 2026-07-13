import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, CreateTableRequest, KeyDef, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import { CreateTableModal } from "./CreateTableModal";

type RowState =
  | { status: "loading" }
  | { status: "loaded"; detail: TableDetail }
  | { status: "error" };

const CHIP_KEY =
  "inline-block rounded-[4px] px-2 py-px font-mono text-[11.5px] bg-[color-mix(in_srgb,#0972d3_12%,#fff)] text-[#0972d3]";

function KeyChip({ keyDef }: { keyDef: KeyDef | undefined }) {
  if (!keyDef) return <span className="text-[#5f6b7a]">-</span>;
  return (
    <span className={CHIP_KEY}>
      {keyDef.name} ({keyDef.attrType})
    </span>
  );
}

function StatusCell({ row }: { row: RowState | undefined }) {
  if (!row || row.status === "loading") return <span className="text-[#5f6b7a]">-</span>;
  if (row.status === "error") return <span className="text-[#5f6b7a]">-</span>;
  const raw = row.detail.status;
  const label = raw === "ACTIVE" ? "アクティブ" : raw;
  return (
    <span className="text-[12.5px] font-semibold text-[#037f0c]">
      <span className="mr-1 align-[1px] text-[9px]">●</span>
      {label}
    </span>
  );
}

function findKey(detail: TableDetail, keyType: KeyDef["keyType"]): KeyDef | undefined {
  return detail.keys.find((k) => k.keyType === keyType);
}

export function TablesPage() {
  const { active } = useConnections();
  const [tables, setTables] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setDetails({});
    try {
      setTables(await api.ddb.listTables(active));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  // Per-row async describe to fill status / keys / index count. Failures are tolerated per row.
  useEffect(() => {
    if (!active || tables.length === 0) return;
    let cancelled = false;
    setDetails(Object.fromEntries(tables.map((t) => [t, { status: "loading" } as RowState])));
    for (const name of tables) {
      api.ddb
        .describeTable(active, name)
        .then((detail) => {
          if (!cancelled) setDetails((prev) => ({ ...prev, [name]: { status: "loaded", detail } }));
        })
        .catch(() => {
          if (!cancelled) setDetails((prev) => ({ ...prev, [name]: { status: "error" } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active, tables]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createTable = async (req: CreateTableRequest) => {
    if (!active) return;
    try {
      await api.ddb.createTable(active, req);
      setCreating(false);
      await load();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const deleteSelected = async () => {
    if (!active || selected.size !== 1) return;
    const name = [...selected][0];
    const typed = window.prompt(`テーブル「${name}」を削除します。確認のためテーブル名を入力してください:`);
    if (typed !== name) return;
    try {
      await api.ddb.deleteTable(active, name);
      await load();
    } catch (e) {
      setError(toAppError(e));
    }
  };

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
        <h1 className="text-[20px] font-bold">テーブル</h1>
        <span className="text-[12.5px] text-[#5f6b7a]">({tables.length})</span>
        <div className="flex-1" />
        <button
          onClick={deleteSelected}
          disabled={selected.size !== 1}
          className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
        >
          削除
        </button>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]"
        >
          テーブルの作成
        </button>
      </div>

      <ErrorBanner error={error} onRetry={load} />

      <div className="overflow-x-auto rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]">
        {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
        {!loading && tables.length === 0 && !error && (
          <div className="p-6 text-center text-[#5f6b7a]">テーブルがありません</div>
        )}
        {!loading && tables.length > 0 && (
          <table className="w-full border-collapse [font-variant-numeric:tabular-nums]">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a] [&>th]:whitespace-nowrap">
                <th className="w-9" />
                <th>名前</th>
                <th>ステータス</th>
                <th>パーティションキー</th>
                <th>ソートキー</th>
                <th>インデックス</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const row = details[t];
                const detail = row?.status === "loaded" ? row.detail : null;
                const indexCount = detail ? detail.gsis.length + detail.lsis.length : null;
                return (
                  <tr
                    key={t}
                    className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] [&>td]:whitespace-nowrap last:[&>td]:border-b-0 hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]"
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${t} を選択`}
                        checked={selected.has(t)}
                        onChange={() => toggle(t)}
                      />
                    </td>
                    <td>
                      <Link
                        to={`/dynamodb/tables/${encodeURIComponent(t)}`}
                        className="font-semibold text-[#0972d3] no-underline hover:underline"
                      >
                        {t}
                      </Link>
                    </td>
                    <td>
                      <StatusCell row={row} />
                    </td>
                    <td>{detail ? <KeyChip keyDef={findKey(detail, "HASH")} /> : <span className="text-[#5f6b7a]">-</span>}</td>
                    <td>{detail ? <KeyChip keyDef={findKey(detail, "RANGE")} /> : <span className="text-[#5f6b7a]">-</span>}</td>
                    <td>{indexCount ?? <span className="text-[#5f6b7a]">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && <CreateTableModal onSubmit={createTable} onClose={() => setCreating(false)} />}
    </div>
  );
}
