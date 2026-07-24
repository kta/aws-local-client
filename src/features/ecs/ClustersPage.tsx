import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ClusterSummary } from "../../api/ecs";
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
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { EcsUnsupported } from "./EcsUnsupported";

function CreateClusterModal({
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
      title="クラスターの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!trimmed}
          confirmTestId="ecs-cluster-save"
          busy={submitting}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">クラスター名</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="ecs-cluster-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}

export function ClustersPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<ClusterSummary[]>((profile) => api.ecs.listClusters(profile));
  const clusters = data ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ClusterSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const unsupported =
    fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const bannerError = actionError ?? (fetchError && !unsupported ? fetchError : null);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createCluster = async (name: string) => {
    if (!active) return;
    try {
      await api.ecs.createCluster(active, name);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedCluster = selectedName
    ? clusters.find((c) => c.name === selectedName) ?? null
    : null;

  const columns: Column<ClusterSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (c) => (
        <Link
          to={`/ecs/clusters/${encodeURIComponent(c.name)}`}
          data-testid={`ecs-cluster-row-${c.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {c.name}
        </Link>
      ),
    },
    { key: "status", header: "ステータス", render: (c) => c.status },
    {
      key: "services",
      header: "サービス数",
      render: (c) => String(c.activeServicesCount),
    },
    {
      key: "tasks",
      header: "実行中タスク数",
      render: (c) => String(c.runningTasksCount),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="クラスター"
          count={unsupported ? undefined : clusters.length}
          titleTestId="ecs-clusters-heading"
          countTestId="ecs-clusters-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedCluster && setDeleting(selectedCluster)}
                disabled={selected.size !== 1}
                data-testid="ecs-cluster-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button
                variant="primary"
                onClick={() => setCreating(true)}
                data-testid="ecs-cluster-create"
              >
                クラスターの作成
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && <EcsUnsupported error={unsupported} />}

        <ErrorBanner error={bannerError} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={clusters}
              rowKey={(c) => c.name}
              loading={loading}
              emptyText={fetchError ? undefined : "クラスターがありません"}
              selection={{
                isSelected: (c) => selected.has(c.name),
                onToggle: (c) => toggle(c.name),
                ariaLabel: (c) => `${c.name} を選択`,
              }}
            />
          </Card>
        )}

        {creating && (
          <CreateClusterModal onSubmit={createCluster} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="クラスターの削除"
            description={
              <>
                クラスター <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためクラスター名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              try {
                await api.ecs.deleteCluster(active, deleting.name);
                setDeleting(null);
                setSelected(new Set());
                await reload();
              } catch (e) {
                setDeleting(null);
                setActionError(toAppError(e));
              }
            }}
            onClose={() => setDeleting(null)}
            inputTestId="ecs-cluster-delete-input"
            confirmTestId="ecs-cluster-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
