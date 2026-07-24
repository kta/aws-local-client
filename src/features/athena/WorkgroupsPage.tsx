import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { WorkgroupSummary } from "../../api/athena";
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

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function WorkgroupsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<WorkgroupSummary[]>((profile) => api.athena.listWorkgroups(profile));
  const workgroups = data ?? [];
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WorkgroupSummary | null>(null);

  // An unsupported describe takes over the page with the athena-unsupported
  // banner; other errors stay a normal error banner (RDS DashboardPage pattern).
  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const listError = fetchError && !unsupported ? fetchError : null;

  const createWorkgroup = async (name: string, description: string) => {
    if (!active) return;
    await api.athena.createWorkgroup(active, name, description.trim() || undefined);
    setCreating(false);
    setActionError(null);
    await reload();
  };

  const columns: Column<WorkgroupSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (w) => <span data-testid={`workgroup-row-${w.name}`}>{w.name}</span>,
    },
    { key: "state", header: "状態", render: (w) => w.state ?? "-" },
    { key: "description", header: "説明", render: (w) => w.description ?? "-" },
    {
      key: "actions",
      header: "",
      render: (w) => (
        <button
          onClick={() => setDeleting(w)}
          data-testid={`workgroup-delete-${w.name}`}
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
          title="ワークグループ"
          count={unsupported ? undefined : workgroups.length}
          titleTestId="workgroups-heading"
          countTestId="workgroups-count"
        >
          {!unsupported && (
            <Button
              variant="primary"
              onClick={() => setCreating(true)}
              data-testid="workgroups-create"
            >
              ワークグループの作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="athena-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは Athena ワークグループをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: floci、ministack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? listError} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={workgroups}
              rowKey={(w) => w.name}
              loading={loading}
              emptyText={listError ? undefined : "ワークグループがありません"}
            />
          </Card>
        )}

        {creating && (
          <CreateWorkgroupModal
            onSubmit={createWorkgroup}
            onError={(e) => setActionError(e)}
            onClose={() => setCreating(false)}
          />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ワークグループの削除"
            description={
              <>
                ワークグループ <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.athena.deleteWorkgroup(active, deleting.name);
              setDeleting(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="workgroups-delete-input"
            confirmTestId="workgroups-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function CreateWorkgroupModal({
  onSubmit,
  onError,
  onClose,
}: {
  onSubmit: (name: string, description: string) => Promise<void>;
  onError: (e: AppError) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), description);
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ワークグループの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="wg-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>名前</span>
          <input
            className={FIELD}
            data-testid="wg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>説明(任意)</span>
          <input
            className={FIELD}
            data-testid="wg-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
