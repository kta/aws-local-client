import { useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { CreateQueueRequest, QueueSummary } from "../../api/sqs";
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
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateQueueModal } from "./CreateQueueModal";

export function QueuesPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<QueueSummary[]>((profile) => api.sqs.listQueues(profile));
  const queues = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<QueueSummary | null>(null);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createQueue = async (req: CreateQueueRequest) => {
    if (!active) return;
    try {
      await api.sqs.createQueue(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedQueue = selectedName ? queues.find((q) => q.name === selectedName) ?? null : null;

  const columns: Column<QueueSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (q) => (
        <Link
          to={`/sqs/queues/${encodeURIComponent(q.name)}`}
          data-testid={`queue-link-${q.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {q.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "種別",
      render: (q) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {q.fifo ? "FIFO" : "Standard"}
        </span>
      ),
    },
    {
      key: "messages",
      header: "メッセージ数(概算)",
      render: (q) => (
        <span data-testid={`queue-msgs-${q.name}`}>{q.approximateMessages.toLocaleString()}</span>
      ),
    },
    {
      key: "notVisible",
      header: "処理中(概算)",
      render: (q) => q.approximateNotVisible.toLocaleString(),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="キュー"
          count={queues.length}
          titleTestId="queues-heading"
          countTestId="queues-count"
        >
          <button
            onClick={() => selectedQueue && setDeleting(selectedQueue)}
            disabled={selected.size !== 1}
            data-testid="queues-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="queues-create">
            キューの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={queues}
            rowKey={(q) => q.name}
            loading={loading}
            emptyText={fetchError ? undefined : "キューがありません"}
            selection={{
              isSelected: (q) => selected.has(q.name),
              onToggle: (q) => toggle(q.name),
              ariaLabel: (q) => `${q.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateQueueModal onSubmit={createQueue} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="キューの削除"
            description={
              <>
                キュー <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためキュー名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.sqs.deleteQueue(active, deleting.queueUrl);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="queues-delete-input"
            confirmTestId="queues-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
