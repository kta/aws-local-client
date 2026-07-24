import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { CreateFunctionRequest, FunctionSummary } from "../../api/lambda";
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
import { CreateFunctionModal } from "./CreateFunctionModal";

export function FunctionsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<FunctionSummary[]>((profile) => api.lambda.listFunctions(profile));
  const functions = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FunctionSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createFunction = async (req: CreateFunctionRequest) => {
    if (!active) return;
    try {
      await api.lambda.createFunction(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedFn = selectedName ? functions.find((f) => f.name === selectedName) ?? null : null;

  const columns: Column<FunctionSummary>[] = [
    {
      key: "name",
      header: "関数名",
      render: (f) => (
        <Link
          to={`/lambda/functions/${encodeURIComponent(f.name)}`}
          data-testid={`fn-link-${f.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {f.name}
        </Link>
      ),
    },
    { key: "runtime", header: "ランタイム", render: (f) => f.runtime ?? "-" },
    { key: "handler", header: "ハンドラ", render: (f) => f.handler ?? "-" },
    { key: "lastModified", header: "更新日時", render: (f) => formatDate(f.lastModified) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="関数"
          count={functions.length}
          titleTestId="functions-heading"
          countTestId="functions-count"
        >
          <button
            onClick={() => selectedFn && setDeleting(selectedFn)}
            disabled={selected.size !== 1}
            data-testid="functions-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="lambda-create">
            関数の作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={functions}
            rowKey={(f) => f.name}
            loading={loading}
            emptyText={fetchError ? undefined : "関数がありません"}
            selection={{
              isSelected: (f) => selected.has(f.name),
              onToggle: (f) => toggle(f.name),
              ariaLabel: (f) => `${f.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateFunctionModal onSubmit={createFunction} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="関数の削除"
            description={
              <>
                関数 <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため関数名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.lambda.deleteFunction(active, deleting.name);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="lambda-delete-input"
            confirmTestId="lambda-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
