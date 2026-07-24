import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { LogGroup } from "../../api/cloudwatch";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
} from "../../components/ui";
import { formatBytes } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

function CreateLogGroupModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ロググループの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!trimmed}
          confirmTestId="lg-save"
          busy={submitting}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">ロググループ名</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="lg-name"
          value={name}
          placeholder="/nlsd/my-app"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}

export function LogGroupsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<LogGroup[]>((profile) => api.cloudwatch.listLogGroups(profile));
  const groups = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<LogGroup | null>(null);
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

  const createGroup = async (name: string) => {
    if (!active) return;
    try {
      await api.cloudwatch.createLogGroup(active, name);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedGroup = selectedName ? groups.find((g) => g.name === selectedName) ?? null : null;

  const columns: Column<LogGroup>[] = [
    {
      key: "name",
      header: "名前",
      render: (g) => (
        <Link
          to={`/cloudwatch/log-groups/${encodeURIComponent(g.name)}`}
          data-testid={`lg-link-${g.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {g.name}
        </Link>
      ),
    },
    {
      key: "retention",
      header: "保持期間",
      render: (g) => (g.retentionInDays == null ? "無期限" : `${g.retentionInDays} 日`),
    },
    { key: "size", header: "サイズ", render: (g) => formatBytes(g.storedBytes) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="ロググループ"
          count={groups.length}
          titleTestId="log-groups-heading"
          countTestId="log-groups-count"
        >
          <button
            onClick={() => selectedGroup && setDeleting(selectedGroup)}
            disabled={selected.size !== 1}
            data-testid="lg-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="lg-create">
            ロググループの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={groups}
            rowKey={(g) => g.name}
            loading={loading}
            emptyText={fetchError ? undefined : "ロググループがありません"}
            selection={{
              isSelected: (g) => selected.has(g.name),
              onToggle: (g) => toggle(g.name),
              ariaLabel: (g) => `${g.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateLogGroupModal onSubmit={createGroup} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ロググループの削除"
            description={
              <>
                ロググループ <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.cloudwatch.deleteLogGroup(active, deleting.name);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="lg-delete-input"
            confirmTestId="lg-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
