import { useState } from "react";
import { Link } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { SecretSummary } from "../../api/secretsmanager";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateSecretModal } from "./CreateSecretModal";
import { DeleteSecretModal } from "./DeleteSecretModal";

export function SecretsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<SecretSummary[]>((profile) => api.secretsManager.list(profile));
  const secrets = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createSecret = async (name: string, secretString: string, description: string) => {
    if (!active) return;
    try {
      await api.secretsManager.create(active, name, secretString, description || undefined);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;

  const columns: Column<SecretSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (s) => (
        <Link
          to={`/secrets-manager/secrets/${encodeURIComponent(s.name)}`}
          data-testid={`secret-link-${s.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {s.name}
        </Link>
      ),
    },
    {
      key: "description",
      header: "説明",
      render: (s) => <span className="text-[#5f6b7a]">{s.description ?? "-"}</span>,
    },
    {
      key: "lastChangedDate",
      header: "更新日時",
      render: (s) => <span className="text-[#5f6b7a]">{formatDate(s.lastChangedDate)}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="シークレット"
          count={secrets.length}
          titleTestId="secrets-heading"
          countTestId="secrets-count"
        >
          <button
            onClick={() => selectedName && setDeletingName(selectedName)}
            disabled={selected.size !== 1}
            data-testid="secrets-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="secrets-create">
            シークレットの保存
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={secrets}
            rowKey={(s) => s.name}
            rowTestId="secret-row"
            loading={loading}
            emptyText={fetchError ? undefined : "シークレットがありません"}
            selection={{
              isSelected: (s) => selected.has(s.name),
              onToggle: (s) => toggle(s.name),
              ariaLabel: (s) => `${s.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateSecretModal onSubmit={createSecret} onClose={() => setCreating(false)} />
        )}

        {deletingName && (
          <DeleteSecretModal
            name={deletingName}
            onConfirm={async (force, recoveryDays) => {
              if (!active) return;
              await api.secretsManager.delete(
                active,
                deletingName,
                force,
                force ? undefined : recoveryDays,
              );
              setDeletingName(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeletingName(null)}
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
