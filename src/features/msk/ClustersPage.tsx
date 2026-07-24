import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { MskClusterSummary } from "../../api/msk";
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
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateClusterModal } from "./CreateClusterModal";
import { isMskUnsupported } from "./unsupported";
import { UnsupportedBanner } from "./UnsupportedBanner";

export function ClustersPage() {
  const { active } = useConnections();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<MskClusterSummary[]>((profile) => api.msk.listClusters(profile));
  const clusters = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MskClusterSummary | null>(null);

  // Dashboard quick action deep-links here with ?create=1 to open the modal.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      searchParams.delete("create");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // R93: an unsupported load error takes over from the generic error banner and
  // hides the create action.
  const unsupported = loadError && isMskUnsupported(loadError) ? loadError : null;
  const error = opError ?? (loadError && !unsupported ? loadError : null);

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const createCluster = async (name: string, numBrokers: number) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.msk.createCluster(active, name, numBrokers);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<MskClusterSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold",
      render: (c) => (
        <button
          onClick={() => navigate(`/msk/clusters/${encodeURIComponent(c.name)}`)}
          data-testid={`cluster-row-${c.name}`}
          className="font-semibold text-[#0972d3] hover:underline"
        >
          {c.name}
        </button>
      ),
    },
    {
      key: "state",
      header: "状態",
      render: (c) => <StatusBadge status={c.state} />,
    },
    {
      key: "brokers",
      header: "ブローカー数",
      render: (c) => (c.numberOfBrokerNodes == null ? "-" : String(c.numberOfBrokerNodes)),
    },
    { key: "kafkaVersion", header: "Kafka バージョン", render: (c) => c.kafkaVersion ?? "-" },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (c) => (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setDeleting(c)}
            data-testid="msk-delete"
            className="text-[13px] font-semibold text-[#d13212] hover:underline"
          >
            削除
          </button>
        </div>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="クラスター"
          count={unsupported ? undefined : clusters.length}
          titleTestId="clusters-heading"
          countTestId="clusters-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="msk-create">
              クラスターを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && <UnsupportedBanner error={unsupported} />}

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={clusters}
              rowKey={(c) => c.arn}
              rowTestId="msk-row"
              loading={loading}
              emptyText={<span data-testid="clusters-empty">クラスターがありません</span>}
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
              await api.msk.deleteCluster(active, deleting.arn);
              setDeleting(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="msk-delete-input"
            confirmTestId="msk-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
