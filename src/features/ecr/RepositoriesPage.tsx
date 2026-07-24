import { useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { RepositorySummary } from "../../api/ecr";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateRepositoryModal } from "./CreateRepositoryModal";
import { DeleteRepositoryModal } from "./DeleteRepositoryModal";

export function RepositoriesPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<RepositorySummary[]>((profile) => api.ecr.listRepositories(profile));
  const repos = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // R78: an "unsupported" load error takes over from the generic error banner
  // and hides the create action (localstack has no ECR). Other errors stay a
  // normal error banner while the list keeps rendering.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = opError ?? (loadError && !unsupported ? loadError : null);

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const createRepository = async (name: string) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.ecr.createRepository(active, name);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const copyUri = async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
    } catch {
      // Clipboard access can be denied; copy is a convenience, not critical.
    }
  };

  const columns: Column<RepositorySummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (r) => (
        <Link
          to={`/ecr/repositories/${encodeURIComponent(r.name)}`}
          data-testid={`ecr-link-${r.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          <span data-testid={`ecr-row-${r.name}`}>{r.name}</span>
        </Link>
      ),
    },
    {
      key: "uri",
      header: "URI",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-[#5f6b7a]">{r.uri}</span>
          <button
            onClick={() => copyUri(r.uri)}
            data-testid="ecr-copy-uri"
            className="text-[13px] font-semibold text-[#0972d3] hover:underline"
          >
            コピー
          </button>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "作成日時",
      render: (r) => <span className="text-[#5f6b7a]">{formatDate(r.createdAt)}</span>,
    },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (r) => (
        <button
          onClick={() => setDeleting(r.name)}
          data-testid="ecr-delete"
          className="text-[13px] font-semibold text-[#d13212] hover:underline"
        >
          削除
        </button>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="リポジトリ"
          count={unsupported ? undefined : repos.length}
          titleTestId="ecr-repositories-heading"
          countTestId="ecr-repositories-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="ecr-create">
              リポジトリの作成
            </Button>
          )}
        </PageHeader>

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

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={repos}
              rowKey={(r) => r.name}
              loading={loading}
              emptyText={
                <span data-testid="ecr-repositories-empty">リポジトリがありません</span>
              }
            />
          </Card>
        )}

        {creating && (
          <CreateRepositoryModal onSubmit={createRepository} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <DeleteRepositoryModal
            name={deleting}
            onConfirm={async (force) => {
              if (!active) return;
              await api.ecr.deleteRepository(active, deleting, force);
              setDeleting(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
