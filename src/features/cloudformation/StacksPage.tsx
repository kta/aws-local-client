import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { CfnParameter, CfnStackSummary } from "../../api/cloudformation";
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
  StatusBadge,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateStackModal } from "./CreateStackModal";

export function StacksPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<CfnStackSummary[]>((profile) => api.cloudformation.listStacks(profile));
  const stacks = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CfnStackSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the create modal automatically when navigated with ?create=1.
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

  const createStack = async (name: string, templateBody: string, parameters: CfnParameter[]) => {
    if (!active) return;
    try {
      await api.cloudformation.createStack(active, name, templateBody, parameters);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedStack = selectedName ? stacks.find((s) => s.name === selectedName) ?? null : null;

  const columns: Column<CfnStackSummary>[] = [
    {
      key: "name",
      header: "スタック名",
      render: (s) => (
        <Link
          to={`/cloudformation/stacks/${encodeURIComponent(s.name)}`}
          data-testid={`stack-row-${s.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {s.name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "ステータス",
      render: (s) => <StatusBadge status={s.status} />,
    },
    { key: "createdAt", header: "作成日時", render: (s) => formatDate(s.createdAt) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="スタック"
          count={stacks.length}
          titleTestId="stacks-heading"
          countTestId="stacks-count"
        >
          <button
            onClick={() => selectedStack && setDeleting(selectedStack)}
            disabled={selected.size !== 1}
            data-testid="stacks-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="stacks-create">
            スタックの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={stacks}
            rowKey={(s) => s.name}
            loading={loading}
            emptyText={fetchError ? undefined : "スタックがありません"}
            selection={{
              isSelected: (s) => selected.has(s.name),
              onToggle: (s) => toggle(s.name),
              ariaLabel: (s) => `${s.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateStackModal onSubmit={createStack} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="スタックの削除"
            description={
              <>
                スタック <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためスタック名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.cloudformation.deleteStack(active, deleting.name);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="stacks-delete-input"
            confirmTestId="stacks-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
