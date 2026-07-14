import { useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { BucketSummary } from "../../api/s3";
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
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateBucketModal } from "./CreateBucketModal";

export function BucketsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<BucketSummary[]>((profile) => api.s3.listBuckets(profile));
  const buckets = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createBucket = async (name: string) => {
    if (!active) return;
    try {
      await api.s3.createBucket(active, name);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;

  const columns: Column<BucketSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (b) => (
        <Link
          to={`/s3/buckets/${encodeURIComponent(b.name)}`}
          data-testid={`bucket-link-${b.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {b.name}
        </Link>
      ),
    },
    {
      key: "createdAt",
      header: "作成日時",
      render: (b) => <span className="text-[#5f6b7a]">{formatDate(b.createdAt)}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="バケット"
          count={buckets.length}
          titleTestId="buckets-heading"
          countTestId="buckets-count"
        >
          <button
            onClick={() => selectedName && setDeletingName(selectedName)}
            disabled={selected.size !== 1}
            data-testid="buckets-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="buckets-create">
            バケットの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={buckets}
            rowKey={(b) => b.name}
            loading={loading}
            emptyText={fetchError ? undefined : "バケットがありません"}
            selection={{
              isSelected: (b) => selected.has(b.name),
              onToggle: (b) => toggle(b.name),
              ariaLabel: (b) => `${b.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateBucketModal onSubmit={createBucket} onClose={() => setCreating(false)} />
        )}

        {deletingName && (
          <ConfirmDangerModal
            title="バケットの削除"
            description={
              <>
                バケット <b className="font-mono text-[#16191f]">{deletingName}</b>{" "}
                を削除します。確認のためバケット名を入力してください。
              </>
            }
            requiredText={deletingName}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.s3.deleteBucket(active, deletingName);
              setDeletingName(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeletingName(null)}
            inputTestId="buckets-delete-input"
            confirmTestId="buckets-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
