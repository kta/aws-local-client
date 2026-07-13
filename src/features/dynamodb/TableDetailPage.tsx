import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, IndexDetail, KeyDef, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";
import { formatBytes } from "./explore";

const CARD = "rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]";
const CARD_HEAD = "flex items-center gap-[10px] border-b border-[#d9dee3] px-4 py-3 text-[14.5px] font-bold";
const KV = "grid gap-[14px] p-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]";
const DT = "mb-0.5 text-[12px] text-[#5f6b7a]";
const DD = "m-0 font-semibold";
const BTN = "rounded-lg border border-[#d9dee3] bg-white px-[14px] py-[6px] text-[13px] font-semibold hover:border-[#5f6b7a]";
const BTN_PRIMARY = "rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]";
const BTN_SM = "rounded-md border border-[#d9dee3] bg-white px-[10px] py-[3px] text-[12px] font-semibold hover:border-[#5f6b7a]";
const BTN_DANGER = "rounded-lg border border-[#e08a72] bg-white px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#d13212]";

function keyChip(k: KeyDef) {
  return (
    <span className="inline-block rounded bg-[#0972d31f] px-2 py-px font-mono text-[11.5px] text-[#0972d3]">
      {k.name} ({k.attrType})
    </span>
  );
}

function DeleteTableModal({
  tableName,
  onConfirm,
  onClose,
}: {
  tableName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-bold">テーブルの削除</h2>
        <p className="mb-3 text-sm text-[#5f6b7a]">
          テーブル <b className="font-mono text-[#16191f]">{tableName}</b> を削除します。確認のためテーブル名を入力してください。
        </p>
        <input
          className="w-full rounded border border-[#d9dee3] px-2 py-1 font-mono text-sm"
          data-testid="td-delete-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tableName}
          autoFocus
        />
        {error && <div className="mt-2 text-sm text-[#d13212]">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={BTN}>
            キャンセル
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (e) {
                setError(toAppError(e).message);
              } finally {
                setBusy(false);
              }
            }}
            disabled={text !== tableName || busy}
            data-testid="td-delete-confirm"
            className={`${BTN_DANGER} disabled:opacity-45`}
          >
            {busy ? "削除中..." : "削除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IndexCard({ title, indexes }: { title: string; indexes: IndexDetail[] }) {
  return (
    <div className={`${CARD} mt-[14px] overflow-hidden`}>
      <div className={CARD_HEAD}>{title}</div>
      {indexes.length === 0 ? (
        <div className="border-b border-[#e9ecef] px-4 py-3 text-[13px] text-[#5f6b7a] last:border-0">
          {title.startsWith("ローカル") ? "ローカルセカンダリインデックスはありません" : "インデックスはありません"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#f5f6f7] text-[12px] text-[#5f6b7a]">
                <th className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">名前</th>
                <th className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">パーティションキー</th>
                <th className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">ソートキー</th>
                <th className="border-b border-[#d9dee3] px-[14px] py-[9px] font-semibold">射影</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => {
                const pk = idx.keys.find((k) => k.keyType === "HASH");
                const sk = idx.keys.find((k) => k.keyType === "RANGE");
                return (
                  <tr key={idx.name} className="last:[&>td]:border-0">
                    <td
                      className="border-b border-[#e9ecef] px-[14px] py-[9px] font-mono text-xs"
                      data-testid={`index-name-${idx.name}`}
                    >
                      {idx.name}
                    </td>
                    <td className="border-b border-[#e9ecef] px-[14px] py-[9px]">{pk ? keyChip(pk) : "-"}</td>
                    <td className="border-b border-[#e9ecef] px-[14px] py-[9px]">
                      {sk ? keyChip(sk) : <span className="text-[#5f6b7a]">-</span>}
                    </td>
                    <td className="border-b border-[#e9ecef] px-[14px] py-[9px]">ALL</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Tab = "overview" | "indexes";

export function TableDetailPage() {
  const { tableName } = useParams<{ tableName: string }>();
  const { active } = useConnections();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!active || !tableName) return;
    setError(null);
    try {
      setDetail(await api.ddb.describeTable(active, tableName));
    } catch (e) {
      setError(toAppError(e));
    }
  }, [active, tableName]);

  useEffect(() => {
    void load();
  }, [load]);

  const openExplore = () =>
    navigate(`/dynamodb/explore?table=${encodeURIComponent(tableName ?? "")}`);

  const confirmDelete = async () => {
    if (!active || !tableName) return;
    await api.ddb.deleteTable(active, tableName);
    navigate("/dynamodb/tables");
  };

  const pk = detail?.keys.find((k) => k.keyType === "HASH");
  const sk = detail?.keys.find((k) => k.keyType === "RANGE");
  const avgSize = detail && detail.itemCount > 0 ? detail.sizeBytes / detail.itemCount : 0;

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
        <Link to="/dynamodb/tables" className="font-semibold text-[#0972d3] hover:underline">
          テーブル
        </Link>
        {" / "}
        {tableName}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold">{tableName}</h1>
        <div className="flex-1" />
        <button onClick={() => setDeleting(true)} data-testid="td-delete" className={BTN_DANGER}>
          テーブルの削除
        </button>
        <button onClick={openExplore} data-testid="td-explore" className={BTN_PRIMARY}>
          テーブルの項目を探索
        </button>
      </div>

      <ErrorBanner error={error} onRetry={load} />

      <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
        <button
          onClick={() => setTab("overview")}
          data-testid="td-tab-overview"
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
            tab === "overview" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
          }`}
        >
          概要
        </button>
        <button
          onClick={() => setTab("indexes")}
          data-testid="td-tab-indexes"
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
            tab === "indexes" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
          }`}
        >
          インデックス
        </button>
        {["モニタリング", "バックアップ", "追加の設定"].map((t) => (
          <button
            key={t}
            aria-disabled="true"
            className="-mb-px cursor-not-allowed whitespace-nowrap border-b-2 border-transparent px-4 py-[9px] text-[13.5px] font-semibold text-[#5f6b7a] opacity-45"
          >
            {t}
          </button>
        ))}
      </div>

      {detail && tab === "overview" && (
        <div>
          <div className={`${CARD} overflow-hidden`}>
            <div className={CARD_HEAD}>一般的な情報</div>
            <dl className={KV}>
              <div>
                <dt className={DT}>パーティションキー</dt>
                <dd className={DD} data-testid="td-pk">{pk ? keyChip(pk) : "-"}</dd>
              </div>
              <div>
                <dt className={DT}>ソートキー</dt>
                <dd className={DD} data-testid="td-sk">{sk ? keyChip(sk) : <span className="text-[#5f6b7a]">-</span>}</dd>
              </div>
              <div>
                <dt className={DT}>容量モード</dt>
                <dd className={DD} data-testid="td-capacity">オンデマンド</dd>
              </div>
              <div>
                <dt className={DT}>テーブルステータス</dt>
                <dd className={DD} data-testid="td-status">
                  {detail.status === "ACTIVE" ? (
                    <span className="text-[12.5px] font-semibold text-[#037f0c]">● アクティブ</span>
                  ) : (
                    detail.status
                  )}
                </dd>
              </div>
            </dl>
          </div>
          <div className={`${CARD} mt-[14px] overflow-hidden`}>
            <div className={CARD_HEAD}>
              項目の概要
              <span className="flex-1" />
              <button onClick={openExplore} className={BTN_SM}>
                項目を探索
              </button>
            </div>
            <dl className={KV}>
              <div>
                <dt className={DT}>項目数(概算)</dt>
                <dd className={DD} data-testid="td-item-count">{detail.itemCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt className={DT}>テーブルサイズ</dt>
                <dd className={DD}>{formatBytes(detail.sizeBytes)}</dd>
              </div>
              <div>
                <dt className={DT}>平均項目サイズ</dt>
                <dd className={DD}>{avgSize > 0 ? formatBytes(avgSize) : "-"}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {detail && tab === "indexes" && (
        <div data-testid="td-indexes">
          <IndexCard title={`グローバルセカンダリインデックス (${detail.gsis.length})`} indexes={detail.gsis} />
          <IndexCard title={`ローカルセカンダリインデックス (${detail.lsis.length})`} indexes={detail.lsis} />
        </div>
      )}

      {deleting && tableName && (
        <DeleteTableModal
          tableName={tableName}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
