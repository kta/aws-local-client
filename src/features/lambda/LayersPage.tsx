import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { LayerSummary, PublishLayerRequest } from "../../api/lambda";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

declare global {
  interface Window {
    __E2E_UPLOAD_PATH?: string;
  }
}

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL_TEXT = "text-gray-600";

const RUNTIMES = ["python3.12", "python3.11", "nodejs20.x", "nodejs18.x"];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * The layers API is unavailable on some emulators, in several shapes (measured):
 * kumo answers ListLayers with a NoSuchBucket / 404 body; localstack:3 raises a
 * 500 "list index out of range" internal error rather than a classic
 * unsupported signature. Detection covers all of them.
 */
function isLayersUnsupported(err: AppError): boolean {
  return (
    isUnsupportedOperation(err) ||
    /no ?such ?bucket|404|list index out of range/i.test(err.message)
  );
}

export function LayersPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<LayerSummary[]>((profile) => api.lambda.listLayers(profile));
  const layers = data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState<LayerSummary | null>(null);

  const unsupported = fetchError && isLayersUnsupported(fetchError) ? fetchError : null;
  const error = fetchError && !unsupported ? fetchError : null;

  const publishLayer = async (req: PublishLayerRequest) => {
    if (!active) return;
    try {
      await api.lambda.publishLayerVersion(active, req);
      setPublishing(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedLayer = selected ? layers.find((l) => l.name === selected) ?? null : null;

  const columns: Column<LayerSummary>[] = [
    {
      key: "name",
      header: "レイヤー名",
      render: (l) => (
        <span className="font-semibold text-[#16191f]" data-testid={`layer-name-${l.name}`}>
          {l.name}
        </span>
      ),
    },
    { key: "version", header: "最新バージョン", render: (l) => String(l.version) },
    {
      key: "runtimes",
      header: "互換ランタイム",
      render: (l) => l.compatibleRuntimes.join(", ") || "-",
    },
    { key: "createdDate", header: "作成日時", render: (l) => formatDate(l.createdDate) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="レイヤー"
          count={unsupported ? undefined : layers.length}
          titleTestId="layers-heading"
          countTestId="layers-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedLayer && setDeleting(selectedLayer)}
                disabled={!selectedLayer}
                data-testid="layers-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button
                variant="primary"
                onClick={() => setPublishing(true)}
                data-testid="layer-publish"
              >
                レイヤーの公開
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="lambda-layers-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは Lambda レイヤー API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">
              対応エミュレータ: localstack:3、floci、ministack
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={layers}
              rowKey={(l) => l.name}
              loading={loading}
              rowTestId="lambda-layer-row"
              emptyText={fetchError ? undefined : "レイヤーがありません"}
              selection={{
                isSelected: (l) => selected === l.name,
                onToggle: (l) => setSelected((prev) => (prev === l.name ? null : l.name)),
                ariaLabel: (l) => `${l.name} を選択`,
              }}
            />
          </Card>
        )}

        {publishing && (
          <PublishLayerModal onSubmit={publishLayer} onClose={() => setPublishing(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="レイヤーバージョンの削除"
            description={
              <>
                レイヤー <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                のバージョン {deleting.version}{" "}
                を削除します。確認のためレイヤー名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.lambda.deleteLayerVersion(active, deleting.name, deleting.version);
              setDeleting(null);
              setSelected(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="layer-delete-input"
            confirmTestId="layer-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function PublishLayerModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: PublishLayerRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [zipPath, setZipPath] = useState("");
  const [runtimes, setRuntimes] = useState<Set<string>>(new Set(["python3.12"]));
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && zipPath.length > 0;

  const pickZip = async () => {
    let path = window.__E2E_UPLOAD_PATH;
    if (path === undefined) {
      const chosen = await open({
        multiple: false,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });
      if (typeof chosen !== "string") return;
      path = chosen;
    }
    setZipPath(path);
  };

  const toggleRuntime = (rt: string) =>
    setRuntimes((prev) => {
      const next = new Set(prev);
      if (next.has(rt)) next.delete(rt);
      else next.add(rt);
      return next;
    });

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmed,
        zipPath,
        compatibleRuntimes: [...runtimes],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="レイヤーの公開"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="公開"
          confirmingLabel="公開中..."
          confirmDisabled={!valid}
          confirmTestId="layer-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className={LABEL_TEXT}>レイヤー名</span>
          <input
            className={FIELD}
            data-testid="layer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div>
          <span className={LABEL_TEXT}>zip</span>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={pickZip}
              data-testid="layer-zip"
              className="rounded-lg border border-[#d9dee3] px-[14px] py-[6px] text-[13px] font-semibold text-[#0972d3] hover:border-[#5f6b7a]"
            >
              zip を選択
            </button>
            <span className="truncate text-xs text-gray-500" data-testid="layer-zip-name">
              {zipPath ? baseName(zipPath) : "未選択"}
            </span>
          </div>
        </div>

        <div>
          <span className={LABEL_TEXT}>互換ランタイム</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {RUNTIMES.map((rt) => (
              <label key={rt} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  data-testid={`layer-rt-${rt}`}
                  checked={runtimes.has(rt)}
                  onChange={() => toggleRuntime(rt)}
                />
                {rt}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
