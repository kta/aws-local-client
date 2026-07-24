import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { StateMachineSummary } from "../../api/stepfunctions";
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
import { CreateStateMachineModal } from "./CreateStateMachineModal";

export function StateMachinesPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<StateMachineSummary[]>((profile) =>
    api.stepfunctions.listStateMachines(profile),
  );
  const machines = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StateMachineSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the create modal when navigated here with ?create=1 (dashboard action).
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

  const createStateMachine = async (name: string, definition: string) => {
    if (!active) return;
    try {
      await api.stepfunctions.createStateMachine(active, name, definition);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedMachine = selectedName
    ? machines.find((m) => m.name === selectedName) ?? null
    : null;

  const columns: Column<StateMachineSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (m) => (
        <Link
          to={`/step-functions/state-machines/${encodeURIComponent(m.name)}`}
          data-testid={`sm-link-${m.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {m.name}
        </Link>
      ),
    },
    { key: "type", header: "タイプ", render: (m) => m.type },
    { key: "createdAt", header: "作成日時", render: (m) => formatDate(m.createdAt) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="ステートマシン"
          count={machines.length}
          titleTestId="state-machines-heading"
          countTestId="state-machines-count"
        >
          <button
            onClick={() => selectedMachine && setDeleting(selectedMachine)}
            disabled={selected.size !== 1}
            data-testid="state-machines-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="state-machines-create"
          >
            ステートマシンの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={machines}
            rowKey={(m) => m.name}
            loading={loading}
            emptyText={fetchError ? undefined : "ステートマシンがありません"}
            selection={{
              isSelected: (m) => selected.has(m.name),
              onToggle: (m) => toggle(m.name),
              ariaLabel: (m) => `${m.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateStateMachineModal
            onSubmit={createStateMachine}
            onClose={() => setCreating(false)}
          />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ステートマシンの削除"
            description={
              <>
                ステートマシン <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.stepfunctions.deleteStateMachine(active, deleting.stateMachineArn);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="state-machines-delete-input"
            confirmTestId="state-machines-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
