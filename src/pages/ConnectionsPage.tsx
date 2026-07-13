import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, toAppError } from "../api/client";
import type { AppError, ConnectionProfile, DetectedEndpoint } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConnections } from "../state/connections";

const CONN_DEFAULT = "#7c4dff";

type ProbeStatus = "checking" | "ok" | "unknown";

const empty = (): ConnectionProfile => ({
  id: crypto.randomUUID(),
  name: "",
  endpointUrl: "http://localhost:4566",
  region: "ap-northeast-1",
  accessKeyId: "dummy",
  secretAccessKey: "dummy",
  color: null,
});

export function ConnectionsPage() {
  const { profiles, refresh, setActiveId } = useConnections();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [detected, setDetected] = useState<DetectedEndpoint[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ProbeStatus>>({});

  // Non-blocking per-profile connection probe on load/change.
  // Probe failures are intentionally not surfaced as errors.
  useEffect(() => {
    let cancelled = false;
    setStatuses((prev) => {
      const next: Record<string, ProbeStatus> = {};
      for (const p of profiles) next[p.id] = prev[p.id] ?? "checking";
      return next;
    });
    for (const p of profiles) {
      api.ddb
        .listTables(p)
        .then(() => {
          if (!cancelled) setStatuses((s) => ({ ...s, [p.id]: "ok" }));
        })
        .catch(() => {
          if (!cancelled) setStatuses((s) => ({ ...s, [p.id]: "unknown" }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const use = (p: ConnectionProfile) => {
    setActiveId(p.id);
    navigate("/");
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.endpointUrl.trim()) {
      setError({ kind: "validation", message: "名前とエンドポイント URL は必須です" });
      return;
    }
    try {
      await api.saveConnection(editing);
      await refresh();
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const remove = async (p: ConnectionProfile) => {
    if (!window.confirm(`接続「${p.name}」を削除しますか?`)) return;
    try {
      await api.deleteConnection(p.id);
      await refresh();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const detect = async () => {
    setDetecting(true);
    try {
      setDetected(await api.detectConnections());
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setDetecting(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    type = "text",
    testId?: string,
  ) => (
    <label className="block text-[13px]">
      <span className="text-[#5f6b7a]">{label}</span>
      <input
        type={type}
        data-testid={testId}
        className="mt-1 w-full rounded-lg border border-[#d9dee3] bg-white px-[10px] py-[6px] text-[13px] text-[#16191f] outline-none focus:border-[#0972d3]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold" data-testid="connections-heading">
          接続管理
        </h1>
        <span className="text-[12.5px] text-[#5f6b7a]">使用するエミュレータを選んで開始します</span>
        <div className="flex-1" />
        <button
          onClick={detect}
          disabled={detecting}
          data-testid="scan-connections"
          className="rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold text-[#16191f] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {detecting ? "スキャン中..." : "ローカルをスキャン"}
        </button>
        <button
          onClick={() => setEditing(empty())}
          data-testid="add-connection"
          className="rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]"
        >
          接続を追加
        </button>
      </div>

      <ErrorBanner error={error} />

      {detected.length > 0 && (
        <div className="mb-[14px] rounded-[10px] border border-[color-mix(in_srgb,#037f0c_40%,#d9dee3)] bg-[color-mix(in_srgb,#037f0c_6%,#ffffff)] px-4 py-3 text-[13px]">
          <b className="text-[#037f0c]">{detected.length} 件のエンドポイントを検出しました</b>
          {detected.map((d) => (
            <div key={d.endpointUrl} className="flex items-center gap-3 pt-2">
              <span className="font-[ui-monospace,SF_Mono,Menlo,monospace] text-[12.5px]">
                {d.endpointUrl}
              </span>
              <span className="text-[12.5px] text-[#5f6b7a]">テーブル {d.tableCount} 件</span>
              <span className="flex-1" />
              <button
                onClick={() =>
                  setEditing({ ...empty(), name: d.endpointUrl, endpointUrl: d.endpointUrl })
                }
                data-testid="detect-add"
                className="rounded-md border border-[#d9dee3] bg-white px-[10px] py-[3px] text-[12px] font-semibold text-[#16191f] hover:border-[#5f6b7a]"
              >
                この内容で追加
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]">
        {profiles.length === 0 && (
          <div className="p-6 text-center text-[13px] text-[#5f6b7a]">
            接続がまだ登録されていません
          </div>
        )}
        {profiles.map((p) => (
          <div
            key={p.id}
            data-testid="connection-row"
            className="flex items-center gap-3 border-b border-[#e9ecef] px-4 py-3 last:border-b-0"
          >
            <span
              className="h-3 w-3 flex-none rounded-full"
              style={{ backgroundColor: p.color || CONN_DEFAULT }}
            />
            <span>
              <b className="text-[14px]">{p.name}</b>
              <br />
              <span className="font-[ui-monospace,SF_Mono,Menlo,monospace] text-[12.5px] text-[#5f6b7a]">
                {p.endpointUrl} / {p.region}
              </span>
            </span>
            <span className="flex-1" />
            {statuses[p.id] === "ok" ? (
              <span className="text-[12.5px] font-semibold text-[#037f0c] before:mr-1 before:align-[1px] before:text-[9px] before:content-['●']">
                接続OK
              </span>
            ) : (
              <span className="text-[12.5px] text-[#5f6b7a]">
                {statuses[p.id] === "checking" ? "確認中..." : "未確認"}
              </span>
            )}
            <button
              onClick={() => use(p)}
              data-testid="use-connection"
              className="rounded-md border border-[#0972d3] bg-[#0972d3] px-[10px] py-[3px] text-[12px] font-semibold text-white hover:bg-[#075bab]"
            >
              この接続を使う
            </button>
            <button
              onClick={() => setEditing({ ...p })}
              data-testid="edit-connection"
              className="rounded-md border border-[#d9dee3] bg-white px-[10px] py-[3px] text-[12px] font-semibold text-[#16191f] hover:border-[#5f6b7a]"
            >
              編集
            </button>
            <button
              onClick={() => remove(p)}
              data-testid="delete-connection"
              className="rounded-md border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] bg-white px-[10px] py-[3px] text-[12px] font-semibold text-[#d13212] hover:border-[#d13212]"
            >
              削除
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-[10px] bg-white p-6 shadow-[0_10px_40px_rgba(0,21,41,.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[16px] font-bold">接続の設定</h2>
            {field(
              "名前",
              editing.name,
              (v) => setEditing({ ...editing, name: v }),
              "text",
              "conn-name",
            )}
            {field(
              "エンドポイント URL",
              editing.endpointUrl,
              (v) => setEditing({ ...editing, endpointUrl: v }),
              "text",
              "conn-endpoint",
            )}
            {field(
              "リージョン",
              editing.region,
              (v) => setEditing({ ...editing, region: v }),
              "text",
              "conn-region",
            )}
            {field("Access Key ID", editing.accessKeyId, (v) =>
              setEditing({ ...editing, accessKeyId: v }),
            )}
            {field(
              "Secret Access Key",
              editing.secretAccessKey,
              (v) => setEditing({ ...editing, secretAccessKey: v }),
              "password",
            )}
            {field(
              "識別色 (例: #7c3aed)",
              editing.color ?? "",
              (v) => setEditing({ ...editing, color: v || null }),
              "text",
              "conn-color",
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold text-[#16191f] hover:border-[#5f6b7a]"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                data-testid="save-connection"
                className="rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
