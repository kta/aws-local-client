import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { CreateDbInstanceRequest, DbInstanceSummary } from "../../api/rds";
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
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateInstanceModal } from "./CreateInstanceModal";

export function InstancesPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DbInstanceSummary[]>((profile) => api.rds.listInstances(profile));
  const instances = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // R34: an "unsupported" load error takes over from the generic error banner and
  // hides the create action. R35: a create error that is NOT an unsupported
  // signature stays a normal error banner while the list keeps rendering.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = opError ?? (loadError && !unsupported ? loadError : null);

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const createInstance = async (req: CreateDbInstanceRequest) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.rds.createInstance(active, req);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<DbInstanceSummary>[] = [
    {
      key: "id",
      header: "識別子",
      className: "font-semibold",
      render: (i) => <span data-testid={`instance-row-${i.id}`}>{i.id}</span>,
    },
    { key: "engine", header: "エンジン" },
    {
      key: "status",
      header: "ステータス",
      render: (i) => <StatusBadge status={i.status} />,
    },
    { key: "instanceClass", header: "クラス" },
    {
      key: "endpoint",
      header: "エンドポイント",
      render: (i) =>
        i.endpointAddress ? (
          `${i.endpointAddress}${i.endpointPort != null ? `:${i.endpointPort}` : ""}`
        ) : (
          <span className="text-[#5f6b7a]">-</span>
        ),
    },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (i) => (
        <button
          onClick={() => setDeletingId(i.id)}
          data-testid="instances-delete"
          className="text-[13px] font-semibold text-[#d13212] hover:underline"
        >
          削除
        </button>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="データベース"
          count={unsupported ? undefined : instances.length}
          titleTestId="instances-heading"
          countTestId="instances-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="instances-create">
              データベースを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="rds-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは RDS API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">
              対応エミュレータ: ministack、floci(--volume /var/run/docker.sock マウント時)
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={instances}
              rowKey={(i) => i.id}
              loading={loading}
              emptyText={
                <span data-testid="instances-empty">データベースインスタンスがありません</span>
              }
            />
          </Card>
        )}

        {creating && (
          <CreateInstanceModal onSubmit={createInstance} onClose={() => setCreating(false)} />
        )}

        {deletingId && (
          <ConfirmDangerModal
            title="データベースの削除"
            description={
              <>
                データベース <b className="font-mono text-[#16191f]">{deletingId}</b>{" "}
                を削除します。確認のため識別子を入力してください。
              </>
            }
            requiredText={deletingId}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.rds.deleteInstance(active, deletingId);
              setDeletingId(null);
              await reload();
            }}
            onClose={() => setDeletingId(null)}
            inputTestId="instances-delete-input"
            confirmTestId="instances-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
