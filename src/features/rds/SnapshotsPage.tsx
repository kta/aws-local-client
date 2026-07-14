import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { DbSnapshot } from "../../api/rds";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  type Column,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

function CreateSnapshotModal({
  instances,
  onSubmit,
  onClose,
}: {
  instances: string[];
  onSubmit: (instanceId: string, snapshotId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [instanceId, setInstanceId] = useState(instances[0] ?? "");
  const [snapshotId, setSnapshotId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = instanceId.trim() && snapshotId.trim();

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(instanceId, snapshotId.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="スナップショットを作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="snap-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">インスタンス</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="snap-instance-select"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          >
            {instances.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">スナップショット ID</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="snap-id-input"
            value={snapshotId}
            onChange={(e) => setSnapshotId(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function RestoreSnapshotModal({
  snapshot,
  onSubmit,
  onClose,
}: {
  snapshot: DbSnapshot;
  onSubmit: (newInstanceId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [newInstanceId, setNewInstanceId] = useState(`${snapshot.instanceId}-restored`);
  const [submitting, setSubmitting] = useState(false);

  const valid = newInstanceId.trim();

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(newInstanceId.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="スナップショットから復元"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="復元"
          confirmingLabel="復元中..."
          confirmDisabled={!valid}
          confirmTestId="restore-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          「{snapshot.id}」から新しいインスタンスへ復元します。
        </p>
        <label className="block text-sm">
          <span className="text-gray-600">新しいインスタンス ID</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="restore-id-input"
            value={newInstanceId}
            onChange={(e) => setNewInstanceId(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

export function SnapshotsPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DbSnapshot[]>((profile) => api.rds.listSnapshots(profile));
  const snapshots = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [instanceIds, setInstanceIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<DbSnapshot | null>(null);

  // R49: unsupported describe takes over with the snapshots-unsupported banner;
  // op errors stay a normal banner.
  const rawError = opError ?? loadError;
  const unsupported = rawError && isUnsupportedOperation(rawError) ? rawError : null;
  const error = rawError && !unsupported ? rawError : null;

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const openCreate = async () => {
    if (!active) return;
    try {
      const list = await api.rds.listInstances(active);
      setInstanceIds(list.map((i) => i.id));
    } catch {
      setInstanceIds([]);
    }
    setCreating(true);
  };

  const createSnapshot = async (instanceId: string, snapshotId: string) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.rds.createSnapshot(active, instanceId, snapshotId);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const restoreSnapshot = async (newInstanceId: string) => {
    if (!active || !restoring) return;
    setOpError(null);
    try {
      await api.rds.restoreSnapshot(active, restoring.id, newInstanceId);
      setRestoring(null);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const deleteSnapshot = async (snapshot: DbSnapshot) => {
    if (!active) return;
    if (!window.confirm(`スナップショット「${snapshot.id}」を削除しますか?`)) return;
    setOpError(null);
    try {
      await api.rds.deleteSnapshot(active, snapshot.id);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<DbSnapshot>[] = [
    {
      key: "id",
      header: "ID",
      className: "font-semibold",
      render: (s) => <span data-testid={`snapshot-row-${s.id}`}>{s.id}</span>,
    },
    { key: "instanceId", header: "インスタンス" },
    {
      key: "status",
      header: "ステータス",
      render: (s) => <StatusBadge status={s.status} />,
    },
    { key: "createdAt", header: "作成日時", render: (s) => formatDate(s.createdAt) },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (s) => (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setRestoring(s)}
            data-testid="snapshot-restore"
            className="text-[13px] font-semibold text-[#0972d3] hover:underline"
          >
            復元
          </button>
          <button
            onClick={() => deleteSnapshot(s)}
            data-testid="snapshots-delete"
            className="text-[13px] font-semibold text-[#d13212] hover:underline"
          >
            削除
          </button>
        </div>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="スナップショット"
          count={unsupported ? undefined : snapshots.length}
          titleTestId="snapshots-heading"
          countTestId="snapshots-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={openCreate} data-testid="snapshots-create">
              スナップショットを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="snapshots-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは RDS スナップショット API をサポートしていません(ministack は対応しています)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <div
            data-testid="snapshots-table"
            className="overflow-x-auto rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]"
          >
            <DataTable
              variant="list"
              columns={columns}
              rows={snapshots}
              rowKey={(s) => s.id}
              loading={loading}
              emptyText={<span data-testid="snapshots-empty">スナップショットがありません</span>}
            />
          </div>
        )}

        {creating && (
          <CreateSnapshotModal
            instances={instanceIds}
            onSubmit={createSnapshot}
            onClose={() => setCreating(false)}
          />
        )}
        {restoring && (
          <RestoreSnapshotModal
            snapshot={restoring}
            onSubmit={restoreSnapshot}
            onClose={() => setRestoring(null)}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
