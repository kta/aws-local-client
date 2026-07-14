import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, BackupSummary } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useConnections } from "../../state/connections";

// R21: emulators that do not implement the backup API surface these signatures.
function isUnsupported(err: AppError): boolean {
  return /unknown ?operation|not supported/i.test(err.message);
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP");
}

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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">バックアップを作成</h2>
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
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1 text-sm">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            data-testid="backup-create-submit"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">バックアップから復元</h2>
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
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1 text-sm">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            data-testid="backup-restore-submit"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "復元中..." : "復元"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BackupsPage() {
  const { active } = useConnections();
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [unsupported, setUnsupported] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    setUnsupported(null);
    try {
      setBackups(await api.ddb.listBackups(active));
    } catch (e) {
      const err = toAppError(e);
      if (isUnsupported(err)) setUnsupported(err);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = async () => {
    if (!active) return;
    try {
      setTables(await api.ddb.listTables(active));
    } catch {
      setTables([]);
    }
    setCreating(true);
  };

  const handleOpError = (e: unknown) => {
    const err = toAppError(e);
    if (isUnsupported(err)) setUnsupported(err);
    else setError(err);
  };

  const createBackup = async (tableName: string, backupName: string) => {
    if (!active) return;
    setError(null);
    setNote(null);
    try {
      await api.ddb.createBackup(active, tableName, backupName);
      setCreating(false);
      await load();
    } catch (e) {
      handleOpError(e);
    }
  };

  const restoreBackup = async (targetTableName: string) => {
    if (!active || !restoring) return;
    setError(null);
    setNote(null);
    try {
      await api.ddb.restoreBackup(active, restoring.backupArn, targetTableName);
      setRestoring(null);
      setNote(`${targetTableName} へ復元を開始しました`);
    } catch (e) {
      handleOpError(e);
    }
  };

  const deleteBackup = async (backup: BackupSummary) => {
    if (!active) return;
    if (!window.confirm(`バックアップ「${backup.backupName}」を削除しますか?`)) return;
    setError(null);
    setNote(null);
    try {
      await api.ddb.deleteBackup(active, backup.backupArn);
      await load();
    } catch (e) {
      handleOpError(e);
    }
  };

  if (!active) {
    return (
      <div className="p-6 text-gray-500">
        接続が未登録です。
        <Link to="/connections" className="text-blue-600 underline">
          接続管理
        </Link>
        から登録してください。
      </div>
    );
  }

  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold" data-testid="backups-heading">
          バックアップ
        </h1>
        {!unsupported && (
          <span className="text-[12.5px] text-[#5f6b7a]" data-testid="backups-count">
            ({backups.length})
          </span>
        )}
        <div className="flex-1" />
        {!unsupported && (
          <button
            onClick={openCreate}
            data-testid="backups-create"
            className="rounded-lg border border-[#0972d3] bg-[#0972d3] px-[14px] py-[6px] text-[13px] font-semibold text-white hover:bg-[#075bab]"
          >
            バックアップを作成
          </button>
        )}
      </div>

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

      <ErrorBanner error={error} onRetry={load} />

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
          {loading && <div className="p-6 text-center text-[#5f6b7a]">読み込み中...</div>}
          {!loading && backups.length === 0 && (
            <div className="p-6 text-center text-[#5f6b7a]" data-testid="backups-empty">
              バックアップがありません
            </div>
          )}
          {!loading && backups.length > 0 && (
            <table className="w-full border-collapse [font-variant-numeric:tabular-nums]">
              <thead>
                <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a] [&>th]:whitespace-nowrap">
                  <th>バックアップ名</th>
                  <th>テーブル</th>
                  <th>ステータス</th>
                  <th>サイズ</th>
                  <th>作成日時</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr
                    key={b.backupArn}
                    data-testid="backup-row"
                    className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] [&>td]:whitespace-nowrap last:[&>td]:border-b-0 hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]"
                  >
                    <td className="font-semibold">{b.backupName}</td>
                    <td>{b.tableName}</td>
                    <td>{b.status}</td>
                    <td>{formatSize(b.sizeBytes)}</td>
                    <td>{formatDate(b.createdAt)}</td>
                    <td className="text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {creating && (
        <CreateBackupModal tables={tables} onSubmit={createBackup} onClose={() => setCreating(false)} />
      )}
      {restoring && (
        <RestoreBackupModal backup={restoring} onSubmit={restoreBackup} onClose={() => setRestoring(null)} />
      )}
    </div>
  );
}
