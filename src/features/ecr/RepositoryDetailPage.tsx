import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { EcrImage } from "../../api/ecr";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

export function RepositoryDetailPage() {
  const { name = "" } = useParams();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<EcrImage[]>((profile) => api.ecr.listImages(profile, name), [name]);
  const images = data ?? [];

  // R79: an unsupported error (e.g. localstack has no ECR) takes over the page
  // with the shared ecr-unsupported banner; other errors stay an error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const columns: Column<EcrImage>[] = [
    {
      key: "tag",
      header: "タグ",
      render: (i) => i.tag ?? <span className="text-[#5f6b7a]">&lt;untagged&gt;</span>,
    },
    {
      key: "digest",
      header: "ダイジェスト",
      render: (i) => <span className="font-mono text-[13px]">{i.digest ?? "-"}</span>,
    },
    {
      key: "sizeBytes",
      header: "サイズ",
      render: (i) => formatBytes(i.sizeBytes),
    },
    {
      key: "pushedAt",
      header: "プッシュ日時",
      render: (i) => formatDate(i.pushedAt),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title={name} titleTestId="ecr-detail-heading" />

        {unsupported && (
          <div
            data-testid="ecr-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは ECR API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">
              対応エミュレータ: ministack、kumo、floci(--volume /var/run/docker.sock マウント時)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <Card title="イメージ" className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={images}
              rowKey={(i) => `${i.digest ?? ""}-${i.tag ?? ""}`}
              rowTestId="ecr-images-table"
              loading={loading}
              emptyText={<span data-testid="ecr-images-empty">イメージがありません</span>}
            />
          </Card>
        )}
      </div>
    </ConnectionRequired>
  );
}
