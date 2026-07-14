import { save } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { api, toAppError } from "../../api/client";
import type { ObjectVersion } from "../../api/s3";
import type { AppError, ConnectionProfile } from "../../api/types";
import { Button, Card } from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

/** Shorten a version id for display while keeping the full value accessible. */
function shortVersion(versionId: string): string {
  return versionId.length > 12 ? `${versionId.slice(0, 12)}…` : versionId;
}

/**
 * Object-versions listing for the current prefix. Read-only apart from
 * per-version download: version-scoped delete is intentionally not offered
 * (R44 — ministack ignores versionId on delete and stacks a delete marker).
 */
export function VersionsView({
  profile,
  bucket,
  prefix,
  onError,
}: {
  profile: ConnectionProfile;
  bucket: string;
  prefix: string;
  onError: (e: AppError | null) => void;
}) {
  const { data, error, loading } = useProfileScopedFetch<ObjectVersion[]>(
    (p) => api.s3.listObjectVersions(p, bucket, prefix),
    [bucket, prefix],
  );

  // Surface the versions-load error through the page-level banner.
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  const download = async (v: ObjectVersion) => {
    const fileName = v.key.split("/").pop() || v.key;
    const destPath = window.__E2E_SAVE_PATH ?? (await save({ defaultPath: fileName }));
    if (!destPath) return; // user cancelled
    onError(null);
    try {
      await api.s3.downloadObjectVersion(profile, bucket, v.key, v.versionId, destPath);
    } catch (e) {
      onError(toAppError(e));
    }
  };

  const versions = data ?? [];

  return (
    <Card className="overflow-x-auto">
      <table
        data-testid="versions-table"
        className="w-full border-collapse [font-variant-numeric:tabular-nums]"
      >
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
            <th>キー</th>
            <th>バージョン ID</th>
            <th>最新</th>
            <th>種別</th>
            <th>サイズ</th>
            <th>更新日時</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-[#5f6b7a]">
                読み込み中...
              </td>
            </tr>
          )}
          {!loading && versions.length === 0 && !error && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-[#5f6b7a]">
                バージョンがありません
              </td>
            </tr>
          )}
          {versions.map((v) => (
            <tr
              key={v.versionId}
              data-testid={`version-row-${v.versionId}`}
              className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
            >
              <td className="font-mono text-xs">{v.key}</td>
              <td className="font-mono text-xs" title={v.versionId}>
                {shortVersion(v.versionId)}
              </td>
              <td className="text-xs">{v.isLatest ? "✓" : ""}</td>
              <td className="text-xs">{v.deleteMarker ? "削除マーカー" : "オブジェクト"}</td>
              <td className="text-xs text-[#5f6b7a]">{v.size == null ? "-" : formatBytes(v.size)}</td>
              <td className="text-xs text-[#5f6b7a]">{formatDate(v.lastModified)}</td>
              <td>
                {!v.deleteMarker && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => download(v)}
                    data-testid={`version-download-${v.versionId}`}
                  >
                    ダウンロード
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
