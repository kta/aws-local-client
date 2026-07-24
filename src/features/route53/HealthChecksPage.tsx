import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { CreateHealthCheckRequest, HealthCheckSummary } from "../../api/route53";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateHealthCheckModal } from "./CreateHealthCheckModal";

/**
 * Health checks are missing on some emulators (kumo answers the endpoint with a
 * plain HTTP 404 rather than an AWS "unsupported" error), so also treat a
 * not-found / 404 load failure as "unsupported" for this page.
 */
function isHealthCheckUnsupported(err: AppError): boolean {
  return isUnsupportedOperation(err) || err.kind === "not_found" || /404|not found/i.test(err.message);
}

export function HealthChecksPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<HealthCheckSummary[]>((profile) =>
    api.route53.listHealthChecks(profile),
  );
  const checks = data ?? [];
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<HealthCheckSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const unsupported = fetchError && isHealthCheckUnsupported(fetchError) ? fetchError : null;
  const error = actionError ?? (fetchError && !unsupported ? fetchError : null);

  const createCheck = async (req: CreateHealthCheckRequest) => {
    if (!active) return;
    try {
      await api.route53.createHealthCheck(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const columns: Column<HealthCheckSummary>[] = [
    {
      key: "target",
      header: "ターゲット",
      className: "font-mono text-[12.5px]",
      render: (h) => <span data-testid={`hc-target-${h.id}`}>{h.target}</span>,
    },
    {
      key: "type",
      header: "タイプ",
      render: (h) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{h.checkType}</span>
      ),
    },
    { key: "port", header: "ポート", render: (h) => (h.port == null ? "-" : String(h.port)) },
    { key: "path", header: "パス", render: (h) => h.resourcePath ?? "-" },
    {
      key: "actions",
      header: "",
      render: (h) => (
        <button
          data-testid={`healthcheck-delete-${h.id}`}
          onClick={() => setDeleting(h)}
          className="text-[12.5px] font-semibold text-[#d13212] hover:underline"
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
          title="ヘルスチェック"
          count={unsupported ? undefined : checks.length}
          titleTestId="healthchecks-heading"
          countTestId="healthchecks-count"
        >
          {!unsupported && (
            <Button
              variant="primary"
              onClick={() => setCreating(true)}
              data-testid="healthcheck-create"
            >
              ヘルスチェックの作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="route53-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータはヘルスチェックをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: ministack、floci、localstack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={checks}
              rowKey={(h) => h.id}
              rowTestId="healthcheck-row"
              loading={loading}
              emptyText={fetchError ? undefined : "ヘルスチェックがありません"}
            />
          </Card>
        )}

        {creating && (
          <CreateHealthCheckModal onSubmit={createCheck} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <Modal
            title="ヘルスチェックの削除"
            onClose={() => setDeleting(null)}
            maxWidth="md"
            footer={
              <ModalFooter
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                  if (!active) return;
                  setBusy(true);
                  try {
                    await api.route53.deleteHealthCheck(active, deleting.id);
                    setDeleting(null);
                    setActionError(null);
                    await reload();
                  } catch (e) {
                    setActionError(toAppError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                confirmLabel="削除"
                confirmingLabel="削除中..."
                confirmVariant="danger"
                confirmTestId="healthcheck-delete-confirm"
                busy={busy}
              />
            }
          >
            <p className="text-sm text-[#5f6b7a]">
              ヘルスチェック <b className="font-mono text-[#16191f]">{deleting.target}</b>{" "}
              を削除します。
            </p>
          </Modal>
        )}
      </div>
    </ConnectionRequired>
  );
}
