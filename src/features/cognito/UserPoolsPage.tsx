import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { UserPoolSummary } from "../../api/cognito";
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
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateUserPoolModal } from "./CreateUserPoolModal";
import { UnsupportedBanner } from "./UnsupportedBanner";

export function UserPoolsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<UserPoolSummary[]>((profile) => api.cognito.listUserPools(profile));
  const pools = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserPoolSummary | null>(null);
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

  // R60: an unsupported list takes over with the cognito-unsupported banner and
  // hides the create action.
  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const listError = fetchError && !unsupported ? fetchError : null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createPool = async (name: string) => {
    if (!active) return;
    try {
      await api.cognito.createUserPool(active, name);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedId = selected.size === 1 ? [...selected][0] : null;
  const selectedPool = selectedId ? pools.find((p) => p.id === selectedId) ?? null : null;

  const columns: Column<UserPoolSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (p) => (
        <Link
          to={`/cognito/user-pools/${encodeURIComponent(p.id)}`}
          data-testid={`pool-link-${p.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {p.name}
        </Link>
      ),
    },
    {
      key: "id",
      header: "プール ID",
      render: (p) => (
        <span className="font-mono text-xs" data-testid={`pool-row-${p.name}`}>
          {p.id}
        </span>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="ユーザープール"
          count={pools.length}
          titleTestId="user-pools-heading"
          countTestId="user-pools-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedPool && setDeleting(selectedPool)}
                disabled={selected.size !== 1}
                data-testid="pools-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button
                variant="primary"
                onClick={() => setCreating(true)}
                data-testid="pools-create"
              >
                ユーザープールの作成
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && <UnsupportedBanner message={unsupported.message} />}

        {!unsupported && (
          <>
            <ErrorBanner error={actionError ?? listError} onRetry={reload} />

            <Card className="overflow-x-auto">
              <DataTable
                variant="list"
                columns={columns}
                rows={pools}
                rowKey={(p) => p.id}
                loading={loading}
                emptyText={listError ? undefined : "ユーザープールがありません"}
                selection={{
                  isSelected: (p) => selected.has(p.id),
                  onToggle: (p) => toggle(p.id),
                  ariaLabel: (p) => `${p.name} を選択`,
                }}
              />
            </Card>
          </>
        )}

        {creating && (
          <CreateUserPoolModal onSubmit={createPool} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ユーザープールの削除"
            description={
              <>
                ユーザープール <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためプール名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.cognito.deleteUserPool(active, deleting.id);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="pools-delete-input"
            confirmTestId="pools-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
