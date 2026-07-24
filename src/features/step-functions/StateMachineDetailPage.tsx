import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ExecutionSummary, StateMachineDetail } from "../../api/stepfunctions";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConnectionRequired } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { StartExecutionModal } from "./StartExecutionModal";

type Tab = "executions" | "definition";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function StateMachineDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { active } = useConnections();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<StateMachineDetail>(async (profile) => {
    // Resolve the ARN from the name (reload-resilient), then describe.
    const list = await api.stepfunctions.listStateMachines(profile);
    const summary = list.find((m) => m.name === name);
    if (!summary) {
      throw { kind: "not_found", message: `state machine ${name} not found` } as AppError;
    }
    return api.stepfunctions.describeStateMachine(profile, summary.stateMachineArn);
  }, [name]);

  const [tab, setTab] = useState<Tab>("executions");
  const [actionError, setActionError] = useState<AppError | null>(null);

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link
            to="/step-functions/state-machines"
            className="font-semibold text-[#0972d3] hover:underline"
          >
            ステートマシン
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="sm-detail-heading">
            {name}
          </h1>
          {detail && (
            <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{detail.type}</span>
          )}
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button
            onClick={() => setTab("executions")}
            data-testid="tab-executions"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "executions"
                ? "border-[#0972d3] text-[#0972d3]"
                : "border-transparent text-[#5f6b7a]"
            }`}
          >
            実行
          </button>
          <button
            onClick={() => setTab("definition")}
            data-testid="tab-definition"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "definition"
                ? "border-[#0972d3] text-[#0972d3]"
                : "border-transparent text-[#5f6b7a]"
            }`}
          >
            定義
          </button>
        </div>

        {tab === "executions" && detail && active && (
          <ExecutionsTab
            profile={active}
            stateMachineArn={detail.stateMachineArn}
            onError={setActionError}
          />
        )}

        {tab === "definition" && detail && active && (
          <DefinitionTab
            profile={active}
            detail={detail}
            onSaved={reload}
            onError={setActionError}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function ExecutionsTab({
  profile,
  stateMachineArn,
  onError,
}: {
  profile: ConnectionProfile;
  stateMachineArn: string;
  onError: (e: AppError | null) => void;
}) {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    onError(null);
    setLoading(true);
    try {
      setExecutions(await api.stepfunctions.listExecutions(profile, stateMachineArn));
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, stateMachineArn]);

  const start = async (input: string) => {
    onError(null);
    try {
      await api.stepfunctions.startExecution(profile, stateMachineArn, input);
      setStarting(false);
      await load();
    } catch (e) {
      onError(toAppError(e));
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setStarting(true)} data-testid="sm-start">
          実行の開始
        </Button>
        <Button onClick={load} data-testid="executions-refresh" disabled={loading}>
          {loading ? "更新中..." : "更新"}
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <table
          data-testid="executions-table"
          className="w-full border-collapse [font-variant-numeric:tabular-nums]"
        >
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>名前</th>
              <th>ステータス</th>
              <th>開始日時</th>
              <th>終了日時</th>
            </tr>
          </thead>
          <tbody>
            {executions.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                  実行がありません。「実行の開始」で開始します。
                </td>
              </tr>
            )}
            {executions.map((e) => (
              <tr
                key={e.executionArn}
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
              >
                <td>
                  <button
                    onClick={() =>
                      navigate(
                        `/step-functions/executions/${encodeURIComponent(e.executionArn)}`,
                      )
                    }
                    data-testid={`exec-link-${e.name}`}
                    className="font-mono text-xs font-semibold text-[#0972d3] hover:underline"
                  >
                    {e.name}
                  </button>
                </td>
                <td className="text-xs" data-testid={`exec-status-${e.name}`}>
                  {e.status}
                </td>
                <td className="text-xs text-[#5f6b7a]">{formatDate(e.startedAt)}</td>
                <td className="text-xs text-[#5f6b7a]">{formatDate(e.stoppedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {starting && (
        <StartExecutionModal onSubmit={start} onClose={() => setStarting(false)} />
      )}
    </div>
  );
}

function DefinitionTab({
  profile,
  detail,
  onSaved,
  onError,
}: {
  profile: ConnectionProfile;
  detail: StateMachineDetail;
  onSaved: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  // Pretty-print the stored definition for display / editing.
  const pretty = (() => {
    try {
      return JSON.stringify(JSON.parse(detail.definition), null, 2);
    } catch {
      return detail.definition;
    }
  })();

  const [definition, setDefinition] = useState(pretty);
  const [saving, setSaving] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    setDefinition(pretty);
    setUnsupported(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  let jsonError: string | null = null;
  try {
    JSON.parse(definition);
  } catch (e) {
    jsonError = e instanceof Error ? e.message : String(e);
  }

  const save = async () => {
    if (jsonError) return;
    setSaving(true);
    setUnsupported(false);
    onError(null);
    try {
      await api.stepfunctions.updateStateMachine(profile, detail.stateMachineArn, definition);
      await onSaved();
    } catch (e) {
      const err = toAppError(e);
      // Some emulators (floci / kumo) do not implement UpdateStateMachine; show a
      // dedicated notice instead of a generic error banner.
      if (isUnsupportedOperation(err)) {
        setUnsupported(true);
      } else {
        onError(err);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="定義" overflowHidden>
      <div className="space-y-3 p-4">
        <div className="text-[12px] text-[#5f6b7a]">
          ARN: <span className="font-mono">{detail.stateMachineArn}</span> / ロール:{" "}
          <span className="font-mono">{detail.roleArn}</span>
        </div>

        <pre
          data-testid="definition-display"
          className="max-h-64 overflow-auto rounded border border-[#e9ecef] bg-[#fafbfc] p-3 font-mono text-xs text-[#16191f]"
        >
          {pretty}
        </pre>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>定義を編集(ASL / JSON)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="definition-edit"
            rows={12}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
          />
          {jsonError && (
            <span className="mt-1 block text-xs text-red-600">JSON エラー: {jsonError}</span>
          )}
        </label>

        {unsupported && (
          <div
            data-testid="sfn-update-unsupported"
            className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            このエミュレータは UpdateStateMachine をサポートしていないため、定義を更新できません。
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || !!jsonError}
            data-testid="definition-save"
          >
            {saving ? "保存中..." : "定義を更新"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
