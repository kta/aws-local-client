import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type {
  CfnEventsResult,
  CfnParameter,
  CfnResource,
  CfnStackDetail,
} from "../../api/cloudformation";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  ConfirmDangerModal,
  ConnectionRequired,
  StatusBadge,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateStackModal } from "./CreateStackModal";

type Tab = "resources" | "outputs" | "parameters" | "events" | "template";

const TABS: { id: Tab; label: string; testId: string }[] = [
  { id: "resources", label: "リソース", testId: "tab-resources" },
  { id: "outputs", label: "出力", testId: "tab-outputs" },
  { id: "parameters", label: "パラメータ", testId: "tab-parameters" },
  { id: "events", label: "イベント", testId: "tab-events" },
  { id: "template", label: "テンプレート", testId: "tab-template" },
];

const HEAD =
  "[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]";
const BODY = "[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]";

export function StackDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { active } = useConnections();
  const navigate = useNavigate();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<CfnStackDetail>(
    (profile) => api.cloudformation.getStack(profile, name ?? ""),
    [name],
  );

  const [tab, setTab] = useState<Tab>("resources");
  const [updating, setUpdating] = useState(false);
  const [updateTemplate, setUpdateTemplate] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);

  // Pre-fill the update modal with the current template (best-effort: an
  // emulator that cannot return it just opens with the default template).
  const openUpdate = async () => {
    if (!active || !name) return;
    setActionError(null);
    try {
      setUpdateTemplate(await api.cloudformation.getTemplate(active, name));
    } catch {
      setUpdateTemplate(undefined);
    }
    setUpdating(true);
  };

  const doUpdate = async (
    _name: string,
    templateBody: string,
    parameters: CfnParameter[],
  ) => {
    if (!active || !name) return;
    try {
      await api.cloudformation.updateStack(active, name, templateBody, parameters);
      setUpdating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/cloudformation/stacks" className="font-semibold text-[#0972d3] hover:underline">
            スタック
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="stack-detail-heading">
            {name}
          </h1>
          {detail && <StatusBadge status={detail.status} testId="stack-detail-status" />}
          <div className="flex-1" />
          <Button
            variant="primary"
            onClick={openUpdate}
            data-testid="stack-update"
            disabled={!detail}
          >
            スタックの更新
          </Button>
          <button
            onClick={() => setDeleting(true)}
            data-testid="stack-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
          >
            削除
          </button>
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={t.testId}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
                tab === t.id
                  ? "border-[#0972d3] text-[#0972d3]"
                  : "border-transparent text-[#5f6b7a]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "resources" && active && name && (
          <ResourcesTab profile={active} name={name} onError={setActionError} />
        )}

        {tab === "outputs" && (
          <Card title="出力" overflowHidden>
            <table data-testid="outputs-table" className="w-full border-collapse">
              <thead>
                <tr className={HEAD}>
                  <th>キー</th>
                  <th>値</th>
                  <th>エクスポート名</th>
                </tr>
              </thead>
              <tbody>
                {(!detail || detail.outputs.length === 0) && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                      出力がありません。
                    </td>
                  </tr>
                )}
                {detail?.outputs.map((o) => (
                  <tr key={o.key} className={BODY} data-testid={`output-row-${o.key}`}>
                    <td className="font-mono text-xs">{o.key}</td>
                    <td className="font-mono text-xs">{o.value}</td>
                    <td className="font-mono text-xs">{o.exportName ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "parameters" && (
          <Card title="パラメータ" overflowHidden>
            <table data-testid="parameters-table" className="w-full border-collapse">
              <thead>
                <tr className={HEAD}>
                  <th>キー</th>
                  <th>値</th>
                </tr>
              </thead>
              <tbody>
                {(!detail || detail.parameters.length === 0) && (
                  <tr>
                    <td colSpan={2} className="p-6 text-center text-[#5f6b7a]">
                      パラメータがありません。
                    </td>
                  </tr>
                )}
                {detail?.parameters.map((p) => (
                  <tr key={p.key} className={BODY} data-testid={`parameter-row-${p.key}`}>
                    <td className="font-mono text-xs">{p.key}</td>
                    <td className="font-mono text-xs">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "events" && active && name && (
          <EventsTab profile={active} name={name} onError={setActionError} />
        )}

        {tab === "template" && active && name && (
          <TemplateTab profile={active} name={name} onError={setActionError} />
        )}

        {updating && detail && (
          <CreateStackModal
            mode="update"
            initialName={detail.name}
            initialTemplate={updateTemplate}
            initialParameters={detail.parameters}
            onSubmit={doUpdate}
            onClose={() => setUpdating(false)}
          />
        )}

        {deleting && name && (
          <ConfirmDangerModal
            title="スタックの削除"
            description={
              <>
                スタック <b className="font-mono text-[#16191f]">{name}</b>{" "}
                を削除します。確認のためスタック名を入力してください。
              </>
            }
            requiredText={name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.cloudformation.deleteStack(active, name);
              setDeleting(false);
              navigate("/cloudformation/stacks");
            }}
            onClose={() => setDeleting(false)}
            inputTestId="stack-delete-input"
            confirmTestId="stack-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function ResourcesTab({
  profile,
  name,
  onError,
}: {
  profile: ConnectionProfile;
  name: string;
  onError: (e: AppError | null) => void;
}) {
  const [resources, setResources] = useState<CfnResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    onError(null);
    api.cloudformation
      .listResources(profile, name)
      .then(setResources)
      .catch((e) => onError(toAppError(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, name]);

  return (
    <Card title="リソース" overflowHidden>
      <table data-testid="resources-table" className="w-full border-collapse">
        <thead>
          <tr className={HEAD}>
            <th>論理 ID</th>
            <th>タイプ</th>
            <th>物理 ID</th>
            <th>ステータス</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                読み込み中...
              </td>
            </tr>
          )}
          {!loading && resources.length === 0 && (
            <tr>
              <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                リソースがありません。
              </td>
            </tr>
          )}
          {resources.map((r) => (
            <tr key={r.logicalId} className={BODY} data-testid={`resource-row-${r.logicalId}`}>
              <td className="font-mono text-xs">{r.logicalId}</td>
              <td className="font-mono text-xs">{r.resourceType}</td>
              <td className="max-w-[280px] truncate font-mono text-xs">{r.physicalId ?? "-"}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EventsTab({
  profile,
  name,
  onError,
}: {
  profile: ConnectionProfile;
  name: string;
  onError: (e: AppError | null) => void;
}) {
  const [result, setResult] = useState<CfnEventsResult | null>(null);

  useEffect(() => {
    onError(null);
    api.cloudformation
      .listEvents(profile, name)
      .then(setResult)
      .catch((e) => onError(toAppError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, name]);

  if (result && !result.supported) {
    return (
      <Card title="イベント" overflowHidden>
        <div className="p-4 text-[13px] text-[#5f6b7a]" data-testid="events-unsupported">
          このエミュレータはスタックイベントの取得に対応していません。
        </div>
      </Card>
    );
  }

  return (
    <Card title="イベント" overflowHidden>
      <table data-testid="events-table" className="w-full border-collapse">
        <thead>
          <tr className={HEAD}>
            <th>日時</th>
            <th>論理 ID</th>
            <th>タイプ</th>
            <th>ステータス</th>
            <th>理由</th>
          </tr>
        </thead>
        <tbody>
          {(!result || result.events.length === 0) && (
            <tr>
              <td colSpan={5} className="p-6 text-center text-[#5f6b7a]">
                イベントがありません。
              </td>
            </tr>
          )}
          {result?.events.map((e) => (
            <tr key={e.eventId} className={BODY}>
              <td className="text-xs text-[#5f6b7a]">{formatDate(e.timestamp)}</td>
              <td className="font-mono text-xs">{e.logicalId ?? "-"}</td>
              <td className="font-mono text-xs">{e.resourceType ?? "-"}</td>
              <td className="font-mono text-xs">{e.status ?? "-"}</td>
              <td className="text-xs text-[#5f6b7a]">{e.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TemplateTab({
  profile,
  name,
  onError,
}: {
  profile: ConnectionProfile;
  name: string;
  onError: (e: AppError | null) => void;
}) {
  const [template, setTemplate] = useState<string>("");

  useEffect(() => {
    onError(null);
    api.cloudformation
      .getTemplate(profile, name)
      .then(setTemplate)
      .catch((e) => onError(toAppError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, name]);

  return (
    <Card title="テンプレート" overflowHidden>
      <pre
        data-testid="template-body"
        className="max-h-[480px] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs text-[#16191f]"
      >
        {template}
      </pre>
    </Card>
  );
}
