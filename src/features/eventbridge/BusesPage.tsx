import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { EventBusSummary } from "../../api/eventbridge";
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

export function BusesPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<EventBusSummary[]>((profile) => api.eventbridge.listBuses(profile));
  const buses = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EventBusSummary | null>(null);
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

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  // The built-in default bus cannot be deleted.
  const selectedBus =
    selectedName && selectedName !== "default"
      ? buses.find((b) => b.name === selectedName) ?? null
      : null;

  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;

  const columns: Column<EventBusSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (b) => (
        <span data-testid={`bus-row-${b.name}`} className="font-semibold text-[#0972d3]">
          {b.name}
        </span>
      ),
    },
    {
      key: "arn",
      header: "ARN",
      render: (b) => <span className="font-mono text-xs text-[#5f6b7a]">{b.arn ?? "-"}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="イベントバス"
          count={buses.length}
          titleTestId="buses-heading"
          countTestId="buses-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedBus && setDeleting(selectedBus)}
                disabled={!selectedBus}
                data-testid="buses-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button
                variant="primary"
                onClick={() => setCreating(true)}
                data-testid="buses-create"
              >
                イベントバスの作成
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="eventbridge-unsupported"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは EventBridge API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? (unsupported ? null : fetchError)} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={buses}
            rowKey={(b) => b.name}
            loading={loading}
            emptyText={fetchError ? undefined : "イベントバスがありません"}
            selection={{
              isSelected: (b) => selected.has(b.name),
              onToggle: (b) => toggle(b.name),
              ariaLabel: (b) => `${b.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateBusModal
            onSubmit={async (name) => {
              if (!active) return;
              try {
                await api.eventbridge.createBus(active, name);
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
            title="イベントバスの削除"
            description={
              <>
                イベントバス <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.eventbridge.deleteBus(active, deleting.name);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="buses-delete-input"
            confirmTestId="buses-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

function CreateBusModal({
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
      title="イベントバスの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="bus-save"
          busy={submitting}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">イベントバス名</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="bus-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}
