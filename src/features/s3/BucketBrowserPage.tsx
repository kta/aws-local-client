import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ObjectDetail, ObjectPage, ObjectSummary } from "../../api/s3";
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
  input as inputCx,
} from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { PropertiesTab } from "./PropertiesTab";
import { VersionsView } from "./VersionsView";

// Test hooks: E2E injects fixed paths so the native dialogs are bypassed.
declare global {
  interface Window {
    __E2E_SAVE_PATH?: string;
    __E2E_UPLOAD_PATH?: string;
  }
}

type Tab = "objects" | "props";

/** Last path segment (relative name) of a full object/prefix key under a prefix. */
function relativeName(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/** Last path segment of a filesystem path (POSIX or Windows separators). */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function BucketBrowserPage() {
  const { active } = useConnections();
  const { bucket = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get("prefix") ?? "";

  const {
    data: firstPage,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<ObjectPage>(
    (profile) => api.s3.listObjects(profile, bucket, prefix),
    [bucket, prefix],
  );

  const [tab, setTab] = useState<Tab>("objects");
  const [showVersions, setShowVersions] = useState(false);
  const [morePages, setMorePages] = useState<ObjectPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Reset accumulated pages / selection / detail when the location changes.
  useEffect(() => {
    setMorePages([]);
    setSelected(new Set());
    setDetail(null);
    setActionError(null);
    setShowVersions(false);
  }, [bucket, prefix]);

  const prefixes = [...(firstPage?.prefixes ?? []), ...morePages.flatMap((p) => p.prefixes)];
  const objects = [...(firstPage?.objects ?? []), ...morePages.flatMap((p) => p.objects)];
  const nextToken =
    morePages.length > 0 ? morePages[morePages.length - 1].nextToken : (firstPage?.nextToken ?? null);

  const navigateTo = (nextPrefix: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextPrefix) next.set("prefix", nextPrefix);
    else next.delete("prefix");
    setSearchParams(next);
  };

  const loadMore = async () => {
    if (!active || !nextToken) return;
    setLoadingMore(true);
    try {
      const page = await api.s3.listObjects(active, bucket, prefix, nextToken);
      setMorePages((prev) => [...prev, page]);
    } catch (e) {
      setActionError(toAppError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const openDetail = async (key: string) => {
    if (!active) return;
    setActionError(null);
    try {
      setDetail(await api.s3.headObject(active, bucket, key));
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  // Path-based upload (R46): pick a file via the dialog plugin (or the E2E
  // seam), then stream it from disk in Rust (multipart above 8MB).
  const onUploadClick = async () => {
    if (!active) return;
    let path = window.__E2E_UPLOAD_PATH;
    if (path === undefined) {
      const chosen = await open({ multiple: false });
      if (typeof chosen !== "string") return; // cancelled
      path = chosen;
    }
    setUploading(true);
    setActionError(null);
    try {
      await api.s3.uploadFile(active, bucket, prefix + baseName(path), path);
      setMorePages([]);
      await reload();
    } catch (err) {
      setActionError(toAppError(err));
    } finally {
      setUploading(false);
    }
  };

  const downloadDetail = async () => {
    if (!active || !detail) return;
    const fileName = detail.key.split("/").pop() || detail.key;
    const destPath = window.__E2E_SAVE_PATH ?? (await save({ defaultPath: fileName }));
    if (!destPath) return; // user cancelled
    setActionError(null);
    try {
      await api.s3.downloadObject(active, bucket, detail.key, destPath);
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Copy requires exactly one selected object to serve as the source.
  const copySource = selected.size === 1 ? [...selected][0] : null;

  const crumbs = prefix.split("/").filter(Boolean);

  const columns: Column<ObjectSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (o) => {
        const rel = relativeName(o.key, prefix);
        return (
          <button
            type="button"
            data-testid={`object-row-${rel}`}
            onClick={() => openDetail(o.key)}
            className="font-semibold text-[#0972d3] hover:underline"
          >
            {rel}
          </button>
        );
      },
    },
    {
      key: "size",
      header: "サイズ",
      render: (o) => <span className="text-[#5f6b7a]">{formatBytes(o.size)}</span>,
    },
    {
      key: "lastModified",
      header: "更新日時",
      render: (o) => <span className="text-[#5f6b7a]">{formatDate(o.lastModified)}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title={`バケット: ${bucket}`} titleTestId="browser-heading">
          {tab === "objects" && (
            <>
              <button
                onClick={() => setDeleting(true)}
                disabled={selected.size === 0}
                data-testid="objects-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button onClick={() => setCopying(true)} disabled={!copySource} data-testid="object-copy">
                コピー
              </Button>
              <Button onClick={() => setCreatingFolder(true)} data-testid="folder-create">
                フォルダの作成
              </Button>
              <Button
                variant="primary"
                onClick={onUploadClick}
                data-testid="object-upload"
                disabled={uploading}
              >
                {uploading ? "アップロード中..." : "アップロード"}
              </Button>
            </>
          )}
        </PageHeader>

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button
            onClick={() => setTab("objects")}
            data-testid="tab-objects"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "objects" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            オブジェクト
          </button>
          <button
            onClick={() => setTab("props")}
            data-testid="tab-props"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "props" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            プロパティ
          </button>
        </div>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        {tab === "props" && active && (
          <PropertiesTab profile={active} bucket={bucket} onError={setActionError} />
        )}

        {tab === "objects" && (
          <>
            {/* Breadcrumbs: index 0 is the bucket root. */}
            <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                data-testid="prefix-crumb-0"
                onClick={() => navigateTo("")}
                className="text-[#0972d3] hover:underline"
              >
                {bucket}
              </button>
              {crumbs.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-[#5f6b7a]">/</span>
                  <button
                    type="button"
                    data-testid={`prefix-crumb-${i + 1}`}
                    onClick={() => navigateTo(crumbs.slice(0, i + 1).join("/") + "/")}
                    className="text-[#0972d3] hover:underline"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </nav>

            <label className="mb-3 flex items-center gap-2 text-sm text-[#5f6b7a]">
              <input
                type="checkbox"
                data-testid="versions-toggle"
                checked={showVersions}
                onChange={(e) => setShowVersions(e.target.checked)}
              />
              バージョンを表示
            </label>

            {showVersions && active ? (
              <VersionsView
                profile={active}
                bucket={bucket}
                prefix={prefix}
                onError={setActionError}
              />
            ) : (
              <div className="flex gap-4">
                <div className="flex-1">
                  <Card className="overflow-x-auto">
                    {prefixes.length > 0 && (
                      <ul className="border-b border-[#e9ecef]">
                        {prefixes.map((p) => {
                          const rel = relativeName(p, prefix);
                          return (
                            <li key={p} className="px-[14px] py-[9px]">
                              <button
                                type="button"
                                data-testid={`prefix-link-${rel}`}
                                onClick={() => navigateTo(p)}
                                className="font-semibold text-[#0972d3] hover:underline"
                              >
                                {rel}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <DataTable
                      variant="list"
                      columns={columns}
                      rows={objects}
                      rowKey={(o) => o.key}
                      loading={loading}
                      emptyText={fetchError ? undefined : "オブジェクトがありません"}
                      selection={{
                        isSelected: (o) => selected.has(o.key),
                        onToggle: (o) => toggle(o.key),
                        ariaLabel: (o) => `${relativeName(o.key, prefix)} を選択`,
                      }}
                    />
                    {nextToken && (
                      <div className="p-3 text-center">
                        <Button
                          variant="secondary"
                          onClick={loadMore}
                          data-testid="objects-more"
                          disabled={loadingMore}
                        >
                          {loadingMore ? "読み込み中..." : "さらに読み込む"}
                        </Button>
                      </div>
                    )}
                  </Card>
                </div>

                {detail && (
                  <Card className="w-80 shrink-0 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-semibold">{detail.key.split("/").pop()}</h2>
                      <button
                        type="button"
                        onClick={() => setDetail(null)}
                        className="text-sm text-[#5f6b7a] hover:underline"
                      >
                        閉じる
                      </button>
                    </div>
                    <dl className="space-y-2 text-sm">
                      <div>
                        <dt className="text-[#5f6b7a]">サイズ</dt>
                        <dd data-testid="od-size">{formatBytes(detail.size)}</dd>
                      </div>
                      <div>
                        <dt className="text-[#5f6b7a]">コンテンツタイプ</dt>
                        <dd data-testid="od-content-type">{detail.contentType ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-[#5f6b7a]">ETag</dt>
                        <dd data-testid="od-etag" className="break-all font-mono text-xs">
                          {detail.etag ?? "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#5f6b7a]">更新日時</dt>
                        <dd data-testid="od-modified">{formatDate(detail.lastModified)}</dd>
                      </div>
                    </dl>
                    <div className="mt-4">
                      <Button variant="primary" onClick={downloadDetail} data-testid="object-download">
                        ダウンロード
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            )}
          </>
        )}

        {deleting && (
          <ConfirmDangerModal
            title="オブジェクトの削除"
            description={
              <>
                選択した {selected.size} 件のオブジェクトを削除します。確認のためバケット名{" "}
                <b className="font-mono text-[#16191f]">{bucket}</b> を入力してください。
              </>
            }
            requiredText={bucket}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              for (const key of selected) {
                await api.s3.deleteObject(active, bucket, key);
              }
              setDeleting(false);
              setSelected(new Set());
              setDetail(null);
              setMorePages([]);
              await reload();
            }}
            onClose={() => setDeleting(false)}
            inputTestId="objects-delete-input"
            confirmTestId="objects-delete-confirm"
          />
        )}

        {copying && copySource && (
          <CopyObjectModal
            defaultDest={copySource}
            onClose={() => setCopying(false)}
            onConfirm={async (dest) => {
              if (!active) return;
              setActionError(null);
              try {
                await api.s3.copyObject(active, bucket, copySource, dest);
                setCopying(false);
                setSelected(new Set());
                setMorePages([]);
                await reload();
              } catch (e) {
                setActionError(toAppError(e));
              }
            }}
          />
        )}

        {creatingFolder && (
          <CreateFolderModal
            onClose={() => setCreatingFolder(false)}
            onConfirm={async (name) => {
              if (!active) return;
              setActionError(null);
              try {
                await api.s3.createFolder(active, bucket, prefix + name);
                setCreatingFolder(false);
                setMorePages([]);
                await reload();
              } catch (e) {
                setActionError(toAppError(e));
              }
            }}
          />
        )}

        <div className="mt-4 text-sm">
          <Link to="/s3/buckets" className="text-[#0972d3] hover:underline">
            ← バケット一覧へ戻る
          </Link>
        </div>
      </div>
    </ConnectionRequired>
  );
}

function CopyObjectModal({
  defaultDest,
  onClose,
  onConfirm,
}: {
  defaultDest: string;
  onClose: () => void;
  onConfirm: (dest: string) => Promise<void>;
}) {
  const [dest, setDest] = useState(`${defaultDest}-copy`);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="オブジェクトのコピー"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={async () => {
            setBusy(true);
            try {
              await onConfirm(dest.trim());
            } finally {
              setBusy(false);
            }
          }}
          confirmLabel="コピー"
          confirmingLabel="コピー中..."
          confirmDisabled={!dest.trim()}
          confirmTestId="copy-save"
          busy={busy}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-[#5f6b7a]">コピー先のキー</span>
        <input
          className={`${inputCx} mt-1 w-full`}
          data-testid="copy-dest-input"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        />
      </label>
    </Modal>
  );
}

function CreateFolderModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="フォルダの作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={async () => {
            setBusy(true);
            try {
              await onConfirm(name.trim());
            } finally {
              setBusy(false);
            }
          }}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!name.trim()}
          confirmTestId="folder-save"
          busy={busy}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-[#5f6b7a]">フォルダ名</span>
        <input
          className={`${inputCx} mt-1 w-full`}
          data-testid="folder-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}
