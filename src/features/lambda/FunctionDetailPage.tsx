import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { EnvVar, FunctionDetail, InvokeResult } from "../../api/lambda";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConnectionRequired } from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

declare global {
  interface Window {
    __E2E_UPLOAD_PATH?: string;
  }
}

type Tab = "overview" | "config" | "code" | "test";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function TabButton({
  tab,
  current,
  onClick,
  children,
  testId,
}: {
  tab: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      onClick={() => onClick(tab)}
      data-testid={testId}
      className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
        current === tab ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold text-[#5f6b7a]">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] text-[#16191f]" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export function FunctionDetailPage() {
  const { name = "" } = useParams<{ name: string }>();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<FunctionDetail>(
    (profile) => api.lambda.getFunction(profile, name),
    [name],
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [actionError, setActionError] = useState<AppError | null>(null);

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/lambda/functions" className="font-semibold text-[#0972d3] hover:underline">
            関数
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold">{name}</h1>
          {detail?.runtime && (
            <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{detail.runtime}</span>
          )}
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <TabButton tab="overview" current={tab} onClick={setTab} testId="tab-overview">
            概要
          </TabButton>
          <TabButton tab="config" current={tab} onClick={setTab} testId="tab-config">
            設定
          </TabButton>
          <TabButton tab="code" current={tab} onClick={setTab} testId="tab-code">
            コード
          </TabButton>
          <TabButton tab="test" current={tab} onClick={setTab} testId="tab-test">
            テスト
          </TabButton>
        </div>

        {tab === "overview" && detail && <OverviewTab detail={detail} />}
        {tab === "config" && detail && (
          <ConfigTab
            detail={detail}
            onSaved={reload}
            onError={setActionError}
            functionName={name}
          />
        )}
        {tab === "code" && detail && (
          <CodeTab detail={detail} onSaved={reload} onError={setActionError} functionName={name} />
        )}
        {tab === "test" && <TestTab functionName={name} />}
      </div>
    </ConnectionRequired>
  );
}

function OverviewTab({ detail }: { detail: FunctionDetail }) {
  return (
    <Card>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2" data-testid="fn-overview">
        <Field label="ランタイム" value={detail.runtime ?? "-"} testId="fn-ov-runtime" />
        <Field label="ハンドラ" value={detail.handler ?? "-"} testId="fn-ov-handler" />
        <Field label="メモリ (MB)" value={String(detail.memorySize)} testId="fn-ov-memory" />
        <Field label="タイムアウト (秒)" value={String(detail.timeout)} testId="fn-ov-timeout" />
        <Field label="コードサイズ" value={formatBytes(detail.codeSize)} />
        <Field label="更新日時" value={formatDate(detail.lastModified)} />
        <div className="sm:col-span-2">
          <div className="text-[12.5px] font-semibold text-[#5f6b7a]">環境変数</div>
          {detail.environment.length === 0 ? (
            <div className="mt-0.5 text-[13px] text-[#5f6b7a]" data-testid="fn-ov-env-empty">
              なし
            </div>
          ) : (
            <ul className="mt-0.5 space-y-0.5" data-testid="fn-ov-env">
              {detail.environment.map((e) => (
                <li key={e.key} className="font-mono text-[13px]" data-testid={`fn-ov-env-${e.key}`}>
                  {e.key} = {e.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function ConfigTab({
  detail,
  functionName,
  onSaved,
  onError,
}: {
  detail: FunctionDetail;
  functionName: string;
  onSaved: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  const { active } = useConnections();
  const [memory, setMemory] = useState(detail.memorySize);
  const [timeout, setTimeout] = useState(detail.timeout);
  const [env, setEnv] = useState<EnvVar[]>(detail.environment);
  const [saving, setSaving] = useState(false);

  // Re-sync the form when the underlying function changes (e.g. after reload).
  useEffect(() => {
    setMemory(detail.memorySize);
    setTimeout(detail.timeout);
    setEnv(detail.environment);
  }, [detail]);

  const setEnvAt = (i: number, patch: Partial<EnvVar>) =>
    setEnv((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const addEnv = () => setEnv((prev) => [...prev, { key: "", value: "" }]);
  const removeEnv = (i: number) => setEnv((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!active) return;
    setSaving(true);
    onError(null);
    try {
      await api.lambda.updateFunctionConfig(active, functionName, {
        memorySize: memory,
        timeout,
        environment: env.filter((e) => e.key.trim().length > 0),
      });
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>メモリ (MB)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="fn-cfg-memory"
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>タイムアウト (秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="fn-cfg-timeout"
              value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))}
            />
          </label>
        </div>

        <div>
          <span className={LABEL_TEXT}>環境変数</span>
          <div className="mt-1 space-y-2" data-testid="fn-cfg-env">
            {env.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={`${FIELD} mt-0`}
                  placeholder="キー"
                  data-testid={`fn-cfg-env-key-${i}`}
                  value={e.key}
                  onChange={(ev) => setEnvAt(i, { key: ev.target.value })}
                />
                <input
                  className={`${FIELD} mt-0`}
                  placeholder="値"
                  data-testid={`fn-cfg-env-value-${i}`}
                  value={e.value}
                  onChange={(ev) => setEnvAt(i, { value: ev.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeEnv(i)}
                  data-testid={`fn-cfg-env-remove-${i}`}
                  className="rounded border border-[#d9dee3] px-2 py-1 text-xs text-[#d13212]"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addEnv}
            data-testid="fn-cfg-env-add"
            className="mt-2 rounded border border-[#d9dee3] px-3 py-1 text-xs font-semibold text-[#0972d3]"
          >
            環境変数を追加
          </button>
        </div>

        <div className="pt-2">
          <Button
            variant="primary"
            onClick={save}
            disabled={saving}
            data-testid="fn-cfg-save"
          >
            {saving ? "保存中..." : "設定を保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CodeTab({
  detail,
  functionName,
  onSaved,
  onError,
}: {
  detail: FunctionDetail;
  functionName: string;
  onSaved: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  const { active } = useConnections();
  const [zipPath, setZipPath] = useState("");
  const [uploading, setUploading] = useState(false);

  const pickZip = async () => {
    let path = window.__E2E_UPLOAD_PATH;
    if (path === undefined) {
      const chosen = await open({
        multiple: false,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });
      if (typeof chosen !== "string") return;
      path = chosen;
    }
    setZipPath(path);
  };

  const upload = async () => {
    if (!active || !zipPath) return;
    setUploading(true);
    onError(null);
    try {
      await api.lambda.updateFunctionCode(active, functionName, zipPath);
      setZipPath("");
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <div className="text-[12.5px] font-semibold text-[#5f6b7a]">CodeSha256</div>
          <div className="mt-0.5 break-all font-mono text-[13px]" data-testid="fn-code-sha">
            {detail.codeSha256 ?? "-"}
          </div>
        </div>

        <div>
          <span className={LABEL_TEXT}>コードの再アップロード(zip)</span>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={pickZip}
              data-testid="fn-code-zip"
              className="rounded-lg border border-[#d9dee3] px-[14px] py-[6px] text-[13px] font-semibold text-[#0972d3] hover:border-[#5f6b7a]"
            >
              zip を選択
            </button>
            <span className="truncate text-xs text-gray-500" data-testid="fn-code-zip-name">
              {zipPath ? baseName(zipPath) : "未選択"}
            </span>
          </div>
        </div>

        <div className="pt-1">
          <Button
            variant="primary"
            onClick={upload}
            disabled={!zipPath || uploading}
            data-testid="fn-code-upload"
          >
            {uploading ? "アップロード中..." : "コードを更新"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TestTab({ functionName }: { functionName: string }) {
  const { active } = useConnections();
  const [payload, setPayload] = useState('{\n  "key": "value"\n}');
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [invokeError, setInvokeError] = useState<AppError | null>(null);

  const runInvoke = async () => {
    if (!active) return;
    setInvoking(true);
    setInvokeError(null);
    setResult(null);
    try {
      setResult(await api.lambda.invoke(active, functionName, payload));
    } catch (e) {
      setInvokeError(toAppError(e));
    } finally {
      setInvoking(false);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner error={invokeError} />
      <Card>
        <div className="space-y-3 p-4">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>イベント JSON ペイロード</span>
            <textarea
              className={`${FIELD} font-mono text-xs`}
              rows={6}
              data-testid="fn-test-payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </label>
          <Button
            variant="primary"
            onClick={runInvoke}
            disabled={invoking}
            data-testid="fn-invoke"
          >
            {invoking ? "実行中..." : "テスト実行"}
          </Button>
        </div>
      </Card>

      {result && (
        <Card>
          <div className="space-y-3 p-4" data-testid="fn-invoke-result">
            <div>
              <div className="text-[12.5px] font-semibold text-[#5f6b7a]">ステータスコード</div>
              <div className="mt-0.5 font-mono text-[13px]" data-testid="fn-invoke-status">
                {result.statusCode}
              </div>
            </div>
            {result.functionError && (
              <div>
                <div className="text-[12.5px] font-semibold text-[#d13212]">関数エラー</div>
                <div className="mt-0.5 font-mono text-[13px]" data-testid="fn-invoke-error">
                  {result.functionError}
                </div>
              </div>
            )}
            <div>
              <div className="text-[12.5px] font-semibold text-[#5f6b7a]">レスポンスペイロード</div>
              <pre
                className="mt-0.5 overflow-x-auto rounded bg-[#f4f6f8] p-2 font-mono text-xs"
                data-testid="fn-invoke-payload"
              >
                {result.payload}
              </pre>
            </div>
            <div>
              <div className="text-[12.5px] font-semibold text-[#5f6b7a]">ログ</div>
              <pre
                className="mt-0.5 max-h-60 overflow-auto rounded bg-[#f4f6f8] p-2 font-mono text-xs"
                data-testid="fn-invoke-logs"
              >
                {result.logTail ?? "(ログなし)"}
              </pre>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
