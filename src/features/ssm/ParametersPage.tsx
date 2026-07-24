import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ParameterSummary, PutParameterRequest } from "../../api/ssm";
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
import { CreateParameterModal } from "./CreateParameterModal";

export function ParametersPage() {
  const { active } = useConnections();
  const [prefixInput, setPrefixInput] = useState("");
  const [appliedPrefix, setAppliedPrefix] = useState("");
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<ParameterSummary[]>(
    (profile) => api.ssm.listParameters(profile, appliedPrefix || undefined),
    [appliedPrefix],
  );
  const params = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ParameterSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const applyPrefix = () => setAppliedPrefix(prefixInput.trim());

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createParameter = async (req: PutParameterRequest) => {
    if (!active) return;
    try {
      await api.ssm.putParameter(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedParam = selectedName ? params.find((p) => p.name === selectedName) ?? null : null;

  const columns: Column<ParameterSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (p) => (
        <Link
          to={`/ssm/parameters/${encodeURIComponent(p.name)}`}
          data-testid={`param-link-${p.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {p.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "タイプ",
      render: (p) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{p.type}</span>
      ),
    },
    {
      key: "version",
      header: "バージョン",
      render: (p) => <span data-testid={`param-version-${p.name}`}>{p.version}</span>,
    },
    {
      key: "lastModified",
      header: "最終更新",
      render: (p) => <span className="text-[#5f6b7a]">{formatDate(p.lastModified)}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="パラメータストア"
          count={params.length}
          titleTestId="parameters-heading"
          countTestId="parameters-count"
        >
          <button
            onClick={() => selectedParam && setDeleting(selectedParam)}
            disabled={selected.size !== 1}
            data-testid="params-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="params-create">
            パラメータの作成
          </Button>
        </PageHeader>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="text-gray-600">パスプレフィックスで絞り込み</span>
            <input
              className="mt-1 w-[320px] max-w-full rounded border border-gray-300 px-2 py-1"
              data-testid="ssm-prefix-filter"
              placeholder="/app"
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyPrefix();
              }}
            />
          </label>
          <Button onClick={applyPrefix} data-testid="ssm-prefix-apply">
            適用
          </Button>
        </div>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={params}
            rowKey={(p) => p.name}
            loading={loading}
            emptyText={fetchError ? undefined : "パラメータがありません"}
            selection={{
              isSelected: (p) => selected.has(p.name),
              onToggle: (p) => toggle(p.name),
              ariaLabel: (p) => `${p.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateParameterModal onSubmit={createParameter} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="パラメータの削除"
            description={
              <>
                パラメータ <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためパラメータ名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.ssm.deleteParameter(active, deleting.name);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="params-delete-input"
            confirmTestId="params-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
