import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { ApiKeySummary } from "../../api/apigateway";
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
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

/**
 * True when a listApiKeys failure means "this emulator has no API-key support".
 * Besides the shared unsupported signatures, kumo mis-routes API-key calls to
 * S3 and answers with a NoSuchBucket error, so treat that as unsupported too.
 */
const isKeysUnsupported = (err: { message: string }): boolean =>
  isUnsupportedOperation(err) || /no ?such ?bucket|bucket does not exist/i.test(err.message);

export function ApiKeysPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<ApiKeySummary[]>((profile) => api.apigateway.listApiKeys(profile));
  const keys = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApiKeySummary | null>(null);

  // An unsupported list takes over the page with the shared unsupported banner;
  // other errors stay a normal error banner.
  const unsupported = loadError && isKeysUnsupported(loadError) ? loadError : null;
  const error = actionError ?? (loadError && !unsupported ? loadError : null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedId = selected.size === 1 ? [...selected][0] : null;
  const selectedKey = selectedId ? keys.find((k) => k.id === selectedId) ?? null : null;

  const columns: Column<ApiKeySummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold",
      render: (k) => <span data-testid={`apikey-name-${k.id}`}>{k.name}</span>,
    },
    { key: "id", header: "ID", render: (k) => <span className="font-mono text-xs">{k.id}</span> },
    {
      key: "enabled",
      header: "状態",
      render: (k) => (k.enabled ? "有効" : "無効"),
    },
    { key: "createdDate", header: "作成日時", render: (k) => formatDate(k.createdDate) },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="API キー"
          count={unsupported ? undefined : keys.length}
          titleTestId="api-keys-heading"
          countTestId="api-keys-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedKey && setDeleting(selectedKey)}
                disabled={selected.size !== 1}
                data-testid="api-keys-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button
                variant="primary"
                onClick={() => setCreating(true)}
                data-testid="api-keys-create"
              >
                API キーの作成
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="api-gateway-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは API Gateway の API キーをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={keys}
              rowKey={(k) => k.id}
              loading={loading}
              emptyText={loadError ? undefined : "API キーがありません"}
              rowTestId="apikey-row"
              selection={{
                isSelected: (k) => selected.has(k.id),
                onToggle: (k) => toggle(k.id),
                ariaLabel: (k) => `${k.name} を選択`,
              }}
            />
          </Card>
        )}

        {creating && active && (
          <CreateApiKeyModal
            onSubmit={async (name) => {
              try {
                await api.apigateway.createApiKey(active, name);
                setCreating(false);
                setActionError(null);
                await reload();
              } catch (e) {
                setActionError(toAppError(e));
              }
            }}
            onClose={() => setCreating(false)}
          />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="API キーの削除"
            description={
              <>
                API キー <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため API キー名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.apigateway.deleteApiKey(active, deleting.id);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="api-keys-delete-input"
            confirmTestId="api-keys-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function CreateApiKeyModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = name.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="API キーの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="key-save"
          busy={submitting}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">API キー名</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}
