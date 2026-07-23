import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ApiResource, ApiSummary, StageSummary } from "../../api/apigateway";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConnectionRequired, Modal, ModalFooter } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

type Tab = "resources" | "stages";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";
const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD", "ANY"];

function tabClass(active: boolean): string {
  return `-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
    active ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
  }`;
}

export function ApiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const apiId = id ?? "";
  const { active } = useConnections();
  const {
    data: apiInfo,
    error,
    reload,
  } = useProfileScopedFetch<ApiSummary | null>(async (profile) => {
    const list = await api.apigateway.listApis(profile);
    return list.find((a) => a.id === apiId) ?? null;
  }, [apiId]);

  const [tab, setTab] = useState<Tab>("resources");
  const [actionError, setActionError] = useState<AppError | null>(null);

  const name = apiInfo?.name ?? apiId;

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/api-gateway/apis" className="font-semibold text-[#0972d3] hover:underline">
            API
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="api-detail-heading">
            {name}
          </h1>
          <span className="font-mono text-[12.5px] text-[#5f6b7a]">{apiId}</span>
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button onClick={() => setTab("resources")} data-testid="tab-resources" className={tabClass(tab === "resources")}>
            リソース
          </button>
          <button onClick={() => setTab("stages")} data-testid="tab-stages" className={tabClass(tab === "stages")}>
            ステージ
          </button>
        </div>

        {tab === "resources" && active && (
          <ResourcesTab profile={active} apiId={apiId} onError={setActionError} />
        )}
        {tab === "stages" && active && (
          <StagesTab
            profile={active}
            apiId={apiId}
            endpoint={active.endpointUrl}
            onError={setActionError}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function ResourcesTab({
  profile,
  apiId,
  onError,
}: {
  profile: ConnectionProfile;
  apiId: string;
  onError: (e: AppError | null) => void;
}) {
  const [resources, setResources] = useState<ApiResource[]>([]);
  const [addingResource, setAddingResource] = useState(false);
  const [addingMethod, setAddingMethod] = useState(false);

  const load = async () => {
    onError(null);
    try {
      setResources(await api.apigateway.getResources(profile, apiId));
    } catch (e) {
      onError(toAppError(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, apiId]);

  // Indent depth = number of path segments (root "/" is depth 0).
  const depthOf = (path: string): number =>
    path === "/" ? 0 : path.split("/").filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button data-testid="resource-create" onClick={() => setAddingResource(true)}>
          リソースの作成
        </Button>
        <Button
          data-testid="method-create"
          onClick={() => setAddingMethod(true)}
          disabled={resources.length === 0}
        >
          メソッドの作成
        </Button>
      </div>

      <Card title="リソース" overflowHidden>
        <table
          data-testid="resources-tree"
          className="w-full border-collapse [font-variant-numeric:tabular-nums]"
        >
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>パス</th>
              <th>メソッド</th>
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 && (
              <tr>
                <td colSpan={2} className="p-6 text-center text-[#5f6b7a]">
                  リソースがありません。
                </td>
              </tr>
            )}
            {resources.map((r) => (
              <tr
                key={r.id}
                data-testid="resource-row"
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
              >
                <td className="font-mono text-xs" style={{ paddingLeft: `${14 + depthOf(r.path) * 16}px` }}>
                  {r.path}
                </td>
                <td className="text-xs">
                  {r.methods.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {r.methods.map((m) => (
                        <span
                          key={m}
                          data-testid={`method-badge-${r.id}-${m}`}
                          className="rounded bg-[#0972d31a] px-1.5 py-0.5 font-semibold text-[#0972d3]"
                        >
                          {m}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[#5f6b7a]">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {addingResource && (
        <CreateResourceModal
          resources={resources}
          onSubmit={async (parentId, pathPart) => {
            onError(null);
            try {
              await api.apigateway.createResource(profile, apiId, parentId, pathPart);
              setAddingResource(false);
              await load();
            } catch (e) {
              onError(toAppError(e));
            }
          }}
          onClose={() => setAddingResource(false)}
        />
      )}

      {addingMethod && (
        <CreateMethodModal
          resources={resources}
          onSubmit={async (resourceId, httpMethod, kind, lambdaArn) => {
            onError(null);
            try {
              await api.apigateway.putMethod(profile, apiId, resourceId, httpMethod, {
                kind,
                lambdaArn: lambdaArn || undefined,
              });
              setAddingMethod(false);
              await load();
            } catch (e) {
              onError(toAppError(e));
            }
          }}
          onClose={() => setAddingMethod(false)}
        />
      )}
    </div>
  );
}

function CreateResourceModal({
  resources,
  onSubmit,
  onClose,
}: {
  resources: ApiResource[];
  onSubmit: (parentId: string, pathPart: string) => Promise<void>;
  onClose: () => void;
}) {
  const root = useMemo(() => resources.find((r) => r.path === "/") ?? resources[0], [resources]);
  const [parentId, setParentId] = useState(root?.id ?? "");
  const [pathPart, setPathPart] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid = parentId.length > 0 && pathPart.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(parentId, pathPart.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="リソースの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="resource-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>親リソース</span>
          <select
            className={FIELD}
            data-testid="resource-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>パスパート(例: users)</span>
          <input
            className={FIELD}
            data-testid="resource-path-part"
            value={pathPart}
            onChange={(e) => setPathPart(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function CreateMethodModal({
  resources,
  onSubmit,
  onClose,
}: {
  resources: ApiResource[];
  onSubmit: (
    resourceId: string,
    httpMethod: string,
    kind: "mock" | "lambdaProxy",
    lambdaArn: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [kind, setKind] = useState<"mock" | "lambdaProxy">("mock");
  const [lambdaArn, setLambdaArn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid =
    resourceId.length > 0 && (kind === "mock" || lambdaArn.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(resourceId, httpMethod, kind, lambdaArn.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="メソッドの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="method-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>リソース</span>
          <select
            className={FIELD}
            data-testid="method-resource"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>HTTP メソッド</span>
          <select
            className={FIELD}
            data-testid="method-http"
            value={httpMethod}
            onChange={(e) => setHttpMethod(e.target.value)}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>統合タイプ</span>
          <select
            className={FIELD}
            data-testid="method-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "mock" | "lambdaProxy")}
          >
            <option value="mock">MOCK</option>
            <option value="lambdaProxy">Lambda プロキシ (AWS_PROXY)</option>
          </select>
        </label>
        {kind === "lambdaProxy" && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Lambda 関数 ARN</span>
            <input
              className={FIELD}
              data-testid="method-lambda-arn"
              value={lambdaArn}
              onChange={(e) => setLambdaArn(e.target.value)}
              placeholder="arn:aws:lambda:..."
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

function StagesTab({
  profile,
  apiId,
  endpoint,
  onError,
}: {
  profile: ConnectionProfile;
  apiId: string;
  endpoint: string;
  onError: (e: AppError | null) => void;
}) {
  const [stages, setStages] = useState<StageSummary[]>([]);
  const [deploying, setDeploying] = useState(false);

  const load = async () => {
    onError(null);
    try {
      setStages(await api.apigateway.listStages(profile, apiId));
    } catch (e) {
      onError(toAppError(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, apiId]);

  // Reference invoke URL (LocalStack / floci style). Displayed for convenience;
  // actual invocability varies by emulator.
  const invokeUrl = (stageName: string): string =>
    `${endpoint.replace(/\/$/, "")}/restapis/${apiId}/${stageName}/_user_request_/`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" data-testid="stage-deploy" onClick={() => setDeploying(true)}>
          デプロイの作成
        </Button>
      </div>

      <Card title="ステージ" overflowHidden>
        <table
          data-testid="stages-table"
          className="w-full border-collapse [font-variant-numeric:tabular-nums]"
        >
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>ステージ名</th>
              <th>呼び出し URL</th>
              <th>作成日時</th>
            </tr>
          </thead>
          <tbody>
            {stages.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                  ステージがありません。デプロイを作成してください。
                </td>
              </tr>
            )}
            {stages.map((s) => (
              <tr
                key={s.stageName}
                data-testid="stage-row"
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
              >
                <td className="font-semibold" data-testid={`stage-name-${s.stageName}`}>
                  {s.stageName}
                </td>
                <td className="max-w-[420px] truncate font-mono text-xs" data-testid={`invoke-url-${s.stageName}`}>
                  {invokeUrl(s.stageName)}
                </td>
                <td className="text-xs text-[#5f6b7a]">{formatDate(s.createdDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {deploying && (
        <DeployModal
          onSubmit={async (stageName) => {
            onError(null);
            try {
              await api.apigateway.createDeployment(profile, apiId, stageName);
              setDeploying(false);
              await load();
            } catch (e) {
              onError(toAppError(e));
            }
          }}
          onClose={() => setDeploying(false)}
        />
      )}
    </div>
  );
}

function DeployModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (stageName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [stageName, setStageName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = stageName.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="デプロイの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="デプロイ"
          confirmingLabel="デプロイ中..."
          confirmDisabled={!valid}
          confirmTestId="deploy-save"
          busy={submitting}
        />
      }
    >
      <label className={LABEL}>
        <span className={LABEL_TEXT}>ステージ名(例: dev)</span>
        <input
          className={FIELD}
          data-testid="deploy-stage-name"
          value={stageName}
          onChange={(e) => setStageName(e.target.value)}
        />
      </label>
    </Modal>
  );
}
