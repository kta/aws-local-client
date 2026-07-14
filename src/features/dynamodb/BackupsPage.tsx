import { useCallback, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { AppError, BackupSummary } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  type Column,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
} from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

function CreateBackupModal({
  tables,
  onSubmit,
  onClose,
}: {
  tables: string[];
  onSubmit: (tableName: string, backupName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [tableName, setTableName] = useState(tables[0] ?? "");
  const [backupName, setBackupName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = tableName.trim() && backupName.trim();

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(tableName, backupName.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="バックアップを作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="backup-create-submit"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">テーブル</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="backup-create-table"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">バックアップ名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="backup-create-name"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function RestoreBackupModal({
  backup,
  onSubmit,
  onClose,
}: {
  backup: BackupSummary;
  onSubmit: (targetTableName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [targetTableName, setTargetTableName] = useState(`${backup.tableName}-restored`);
  const [submitting, setSubmitting] = useState(false);

  const valid = targetTableName.trim();

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(targetTableName.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="バックアップから復元"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="復元"
          confirmingLabel="復元中..."
          confirmDisabled={!valid}
          confirmTestId="backup-restore-submit"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          「{backup.backupName}」から新しいテーブルへ復元します。
        </p>
        <label className="block text-sm">
          <span className="text-gray-600">復元先テーブル名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="backup-restore-target"
            value={targetTableName}
            onChange={(e) => setTargetTableName(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

export function BackupsPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<BackupSummary[]>((profile) => api.ddb.listBackups(profile));
  const backups = data ?? [];
  const [tables, setTables] = useState<string[]>([]);
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // R21: unsupported detection applies to both the initial load and op errors;
  // the "unsupported" banner takes over from the generic error banner.
  const rawError = opError ?? loadError;
  const unsupported = rawError && isUnsupportedOperation(rawError) ? rawError : null;
  const error = rawError && !unsupported ? rawError : null;

  const retry = useCallback(async () => {
    setOpError(null);
    setNote(null);
    await reload();
  }, [reload]);

  const openCreate = async () => {
    if (!active) return;
    try {
      setTables(await api.ddb.listTables(active));
    } catch {
      setTables([]);
    }
    setCreating(true);
  };

  const createBackup = async (tableName: string, backupName: string) => {
    if (!active) return;
    setOpError(null);
    setNote(null);
    try {
      await api.ddb.createBackup(active, tableName, backupName);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const restoreBackup = async (targetTableName: string) => {
    if (!active || !restoring) return;
    setOpError(null);
    setNote(null);
    try {
      await api.ddb.restoreBackup(active, restoring.backupArn, targetTableName);
      setRestoring(null);
      setNote(`${targetTableName} へ復元を開始しました`);
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const deleteBackup = async (backup: BackupSummary) => {
    if (!active) return;
    if (!window.confirm(`バックアップ「${backup.backupName}」を削除しますか?`)) return;
    setOpError(null);
    setNote(null);
    try {
      await api.ddb.deleteBackup(active, backup.backupArn);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<BackupSummary>[] = [
    { key: "backupName", header: "バックアップ名", className: "font-semibold" },
    { key: "tableName", header: "テーブル" },
    { key: "status", header: "ステータス" },
    { key: "sizeBytes", header: "サイズ", render: (b) => formatBytes(b.sizeBytes) },
    { key: "createdAt", header: "作成日時", render: (b) => formatDate(b.createdAt) },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (b) => (
        <>
          <button
            onClick={() => setRestoring(b)}
            data-testid="backup-restore"
            className="mr-3 text-[13px] font-semibold text-[#0972d3] hover:underline"
          >
            復元
          </button>
          <button
            onClick={() => deleteBackup(b)}
            data-testid="backup-delete"
            className="text-[13px] font-semibold text-[#d13212] hover:underline"
          >
            削除
          </button>
        </>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="バックアップ"
          count={unsupported ? undefined : backups.length}
          titleTestId="backups-heading"
          countTestId="backups-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={openCreate} data-testid="backups-create">
              バックアップを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="backups-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータはバックアップ API をサポートしていません(ministack は対応しています)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={retry} />

        {note && (
          <div
            data-testid="backups-note"
            className="m-4 rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800"
          >
            {note}
          </div>
        )}

        {!unsupported && (
          <div className="overflow-x-auto rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]">
            <DataTable
              variant="list"
              columns={columns}
              rows={backups}
              rowKey={(b) => b.backupArn}
              rowTestId="backup-row"
              loading={loading}
              emptyText={<span data-testid="backups-empty">バックアップがありません</span>}
            />
          </div>
        )}

        {creating && (
          <CreateBackupModal
            tables={tables}
            onSubmit={createBackup}
            onClose={() => setCreating(false)}
          />
        )}
        {restoring && (
          <RestoreBackupModal
            backup={restoring}
            onSubmit={restoreBackup}
            onClose={() => setRestoring(null)}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
