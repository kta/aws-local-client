import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { IndexDetail, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  KeyChip,
} from "../../components/ui";
import { formatBytes } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { useState } from "react";

const KV = "grid gap-[14px] p-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]";
const DT = "mb-0.5 text-[12px] text-[#5f6b7a]";
const DD = "m-0 font-semibold";

const indexColumns: Column<IndexDetail>[] = [
  {
    key: "name",
    header: "名前",
    render: (idx) => (
      <span data-testid={`index-name-${idx.name}`} className="font-mono text-xs">
        {idx.name}
      </span>
    ),
  },
  {
    key: "pk",
    header: "パーティションキー",
    render: (idx) => {
      const pk = idx.keys.find((k) => k.keyType === "HASH");
      return pk ? <KeyChip keyDef={pk} /> : "-";
    },
  },
  {
    key: "sk",
    header: "ソートキー",
    render: (idx) => <KeyChip keyDef={idx.keys.find((k) => k.keyType === "RANGE")} />,
  },
  { key: "projection", header: "射影", render: () => "ALL" },
];

function IndexCard({ title, indexes }: { title: string; indexes: IndexDetail[] }) {
  return (
    <Card title={title} overflowHidden className="mt-[14px]">
      {indexes.length === 0 ? (
        <div className="border-b border-[#e9ecef] px-4 py-3 text-[13px] text-[#5f6b7a] last:border-0">
          {title.startsWith("ローカル") ? "ローカルセカンダリインデックスはありません" : "インデックスはありません"}
        </div>
      ) : (
        <DataTable variant="results" columns={indexColumns} rows={indexes} rowKey={(idx) => idx.name} />
      )}
    </Card>
  );
}

type Tab = "overview" | "indexes";

export function TableDetailPage() {
  const { tableName } = useParams<{ tableName: string }>();
  const { active } = useConnections();
  const navigate = useNavigate();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<TableDetail>(
    (profile) => api.ddb.describeTable(profile, tableName ?? ""),
    [tableName],
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [deleting, setDeleting] = useState(false);

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
    <ConnectionRequired>
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
          <Button variant="danger" onClick={() => setDeleting(true)} data-testid="td-delete">
            テーブルの削除
          </Button>
          <Button variant="primary" onClick={openExplore} data-testid="td-explore">
            テーブルの項目を探索
          </Button>
        </div>

        <ErrorBanner error={error} onRetry={reload} />

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
            <Card title="一般的な情報" overflowHidden>
              <dl className={KV}>
                <div>
                  <dt className={DT}>パーティションキー</dt>
                  <dd className={DD} data-testid="td-pk">
                    {pk ? <KeyChip keyDef={pk} /> : "-"}
                  </dd>
                </div>
                <div>
                  <dt className={DT}>ソートキー</dt>
                  <dd className={DD} data-testid="td-sk">
                    <KeyChip keyDef={sk} />
                  </dd>
                </div>
                <div>
                  <dt className={DT}>容量モード</dt>
                  <dd className={DD} data-testid="td-capacity">
                    オンデマンド
                  </dd>
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
            </Card>
            <Card
              title="項目の概要"
              overflowHidden
              className="mt-[14px]"
              headerActions={
                <Button size="sm" onClick={openExplore}>
                  項目を探索
                </Button>
              }
            >
              <dl className={KV}>
                <div>
                  <dt className={DT}>項目数(概算)</dt>
                  <dd className={DD} data-testid="td-item-count">
                    {detail.itemCount.toLocaleString()}
                  </dd>
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
            </Card>
          </div>
        )}

        {detail && tab === "indexes" && (
          <div data-testid="td-indexes">
            <IndexCard title={`グローバルセカンダリインデックス (${detail.gsis.length})`} indexes={detail.gsis} />
            <IndexCard title={`ローカルセカンダリインデックス (${detail.lsis.length})`} indexes={detail.lsis} />
          </div>
        )}

        {deleting && tableName && (
          <ConfirmDangerModal
            title="テーブルの削除"
            description={
              <>
                テーブル <b className="font-mono text-[#16191f]">{tableName}</b>{" "}
                を削除します。確認のためテーブル名を入力してください。
              </>
            }
            requiredText={tableName}
            confirmLabel="削除"
            onConfirm={confirmDelete}
            onClose={() => setDeleting(false)}
            inputTestId="td-delete-input"
            confirmTestId="td-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
