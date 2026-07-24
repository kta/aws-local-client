import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ApiSummary } from "../../api/apigateway";
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
import { CreateApiModal } from "./CreateApiModal";

export function ApisPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<ApiSummary[]>((profile) => api.apigateway.listApis(profile));
  const apis = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApiSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the create modal automatically when navigated here with ?create=1.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createApi = async (name: string, description?: string) => {
    if (!active) return;
    try {
      await api.apigateway.createApi(active, name, description);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedId = selected.size === 1 ? [...selected][0] : null;
  const selectedApi = selectedId ? apis.find((a) => a.id === selectedId) ?? null : null;

  const columns: Column<ApiSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (a) => (
        <Link
          to={`/api-gateway/apis/${encodeURIComponent(a.id)}`}
          data-testid={`api-link-${a.id}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {a.name}
        </Link>
      ),
    },
    { key: "id", header: "ID", render: (a) => <span className="font-mono text-xs">{a.id}</span> },
    {
      key: "description",
      header: "説明",
      render: (a) => a.description ?? "-",
    },
    { key: "createdDate", header: "作成日時", render: (a) => formatDate(a.createdDate) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="API"
          count={apis.length}
          titleTestId="apis-heading"
          countTestId="apis-count"
        >
          <button
            onClick={() => selectedApi && setDeleting(selectedApi)}
            disabled={selected.size !== 1}
            data-testid="apis-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="apis-create">
            API の作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={apis}
            rowKey={(a) => a.id}
            loading={loading}
            emptyText={fetchError ? undefined : "API がありません"}
            selection={{
              isSelected: (a) => selected.has(a.id),
              onToggle: (a) => toggle(a.id),
              ariaLabel: (a) => `${a.name} を選択`,
            }}
          />
        </Card>

        {creating && <CreateApiModal onSubmit={createApi} onClose={() => setCreating(false)} />}

        {deleting && (
          <ConfirmDangerModal
            title="API の削除"
            description={
              <>
                API <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため API 名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.apigateway.deleteApi(active, deleting.id);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="apis-delete-input"
            confirmTestId="apis-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
