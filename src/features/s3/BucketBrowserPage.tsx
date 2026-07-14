import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
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
  PageHeader,
} from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

// Test hook: E2E injects a fixed save path so the native dialog is bypassed.
declare global {
  interface Window {
    __E2E_SAVE_PATH?: string;
  }
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Read a File into a base64 string (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Last path segment (relative name) of a full object/prefix key under a prefix. */
function relativeName(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
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

  const [morePages, setMorePages] = useState<ObjectPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset accumulated pages / selection / detail when the location changes.
  useEffect(() => {
    setMorePages([]);
    setSelected(new Set());
    setDetail(null);
    setActionError(null);
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

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !active) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionError({
        kind: "validation",
        message: "ファイルサイズが上限 (100MB) を超えています。",
      });
      return;
    }
    setUploading(true);
    setActionError(null);
    try {
      const bodyBase64 = await fileToBase64(file);
      await api.s3.putObject(
        active,
        bucket,
        prefix + file.name,
        bodyBase64,
        file.type || undefined,
      );
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
          <button
            onClick={() => setDeleting(true)}
            disabled={selected.size === 0}
            data-testid="objects-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button
            variant="primary"
            onClick={onUploadClick}
            data-testid="object-upload"
            disabled={uploading}
          >
            {uploading ? "アップロード中..." : "アップロード"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="object-upload-input"
            className="hidden"
            onChange={onFileChange}
          />
        </PageHeader>

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

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

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

        <div className="mt-4 text-sm">
          <Link to="/s3/buckets" className="text-[#0972d3] hover:underline">
            ← バケット一覧へ戻る
          </Link>
        </div>
      </div>
    </ConnectionRequired>
  );
}
