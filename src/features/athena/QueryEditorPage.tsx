import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { QueryResults } from "../../api/athena";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  card,
  type Column,
  ConnectionRequired,
  cx,
  DataTable,
  input,
  Modal,
  ModalFooter,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useConnections } from "../../state/connections";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

// Terminal Athena query states.
const SUCCEEDED = "SUCCEEDED";
const FAILURE_STATES = new Set(["FAILED", "CANCELLED"]);
// Poll at 500ms up to 30s (spec §3.13).
const POLL_INTERVAL_MS = 500;
const POLL_MAX_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function QueryEditorPage() {
  const { active } = useConnections();
  const [searchParams, setSearchParams] = useSearchParams();

  const [statement, setStatement] = useState("");
  const [results, setResults] = useState<QueryResults | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [unsupported, setUnsupported] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  // A saved query can be loaded into the editor via ?q=<encoded statement>.
  useEffect(() => {
    const q = searchParams.get("q");
    if (q !== null) {
      setStatement(q);
      const next = new URLSearchParams(searchParams);
      next.delete("q");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Clear transient state when the active connection changes; keep the text.
  useEffect(() => {
    setResults(null);
    setError(null);
    setUnsupported(null);
    setRunning(false);
  }, [active]);

  const run = useCallback(async () => {
    if (!active || !statement.trim()) return;
    setRunning(true);
    setError(null);
    setUnsupported(null);
    setResults(null);
    try {
      const ref = await api.athena.startQuery(active, statement);
      const deadline = Date.now() + POLL_MAX_MS;
      // Poll the execution status until it reaches a terminal state.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const status = await api.athena.getQueryExecution(active, ref.executionId);
        if (status.state === SUCCEEDED) break;
        if (FAILURE_STATES.has(status.state)) {
          throw { kind: "internal", message: status.reason ?? `クエリが失敗しました (${status.state})` };
        }
        if (Date.now() > deadline) {
          throw { kind: "internal", message: "クエリがタイムアウトしました (30秒)" };
        }
        await sleep(POLL_INTERVAL_MS);
      }
      setResults(await api.athena.getQueryResults(active, ref.executionId));
    } catch (e) {
      const appErr = toAppError(e);
      if (isUnsupportedOperation(appErr)) setUnsupported(appErr);
      else setError(appErr);
    } finally {
      setRunning(false);
    }
  }, [active, statement]);

  const saveNamedQuery = useCallback(
    async (name: string, database: string) => {
      if (!active) return;
      await api.athena.createNamedQuery(active, name, statement, database.trim() || undefined);
      setSaving(false);
    },
    [active, statement],
  );

  const columns = useMemo<Column<string[]>[]>(() => {
    const cols = results?.columns ?? [];
    return cols.map((name, i) => ({
      key: String(i),
      header: name,
      className: "max-w-[240px] truncate",
      render: (row: string[]) => row[i] ?? "",
    }));
  }, [results]);

  const rows = results?.rows ?? [];
  const runDisabled = running || !statement.trim();
  const showSuccess = results !== null && rows.length === 0;

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="athena-heading">
            クエリエディタ
          </h1>
        </div>

        {unsupported && (
          <div
            data-testid="athena-unsupported"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは Athena をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={run} />

        <Card title="ステートメント" overflowHidden>
          <div className="flex flex-col gap-3 p-4">
            <textarea
              data-testid="athena-statement"
              aria-label="Athena ステートメント"
              className={`${input} h-32 w-full font-mono`}
              placeholder="SELECT 1"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-[10px]">
              <Button variant="primary" onClick={run} disabled={runDisabled} data-testid="athena-run">
                実行
              </Button>
              <Button
                onClick={() => setSaving(true)}
                disabled={!statement.trim()}
                data-testid="athena-save"
              >
                保存
              </Button>
              {running && (
                <span data-testid="athena-running" className="text-[13px] text-[#5f6b7a]">
                  実行中...
                </span>
              )}
            </div>
          </div>
        </Card>

        {showSuccess && (
          <div
            data-testid="athena-success"
            className={cx(card, "mt-[14px] px-4 py-3 text-[13px] text-[#037f51]")}
          >
            クエリを実行しました(結果 0 件)
          </div>
        )}

        {rows.length > 0 && (
          <Card
            overflowHidden
            className="mt-[14px]"
            title={<span data-testid="athena-count">結果 ({rows.length})</span>}
          >
            <div data-testid="athena-results">
              <DataTable
                variant="results"
                columns={columns}
                rows={rows}
                rowKey={(_, i) => String(i)}
                rowTestId="athena-row"
              />
            </div>
          </Card>
        )}

        {saving && (
          <SaveNamedQueryModal
            onSubmit={saveNamedQuery}
            onClose={() => setSaving(false)}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function SaveNamedQueryModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, database: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [database, setDatabase] = useState("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim(), database);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="クエリを保存"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="保存"
          confirmingLabel="保存中..."
          confirmDisabled={!valid}
          confirmTestId="athena-save-confirm"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <ErrorBanner error={error} />
        <label className={LABEL}>
          <span className={LABEL_TEXT}>クエリ名</span>
          <input
            className={FIELD}
            data-testid="athena-save-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>データベース</span>
          <input
            className={FIELD}
            data-testid="athena-save-db"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
