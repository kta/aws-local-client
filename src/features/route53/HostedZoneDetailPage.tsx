import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { RecordSet } from "../../api/route53";
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
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { RecordModal } from "./RecordModal";

interface DetailData {
  zoneName: string;
  records: RecordSet[];
}

/** Strip the "/hostedzone/" prefix so the bare id can be a URL segment / API arg. */
function bareZoneId(raw: string): string {
  return raw.replace(/^\/hostedzone\//, "");
}

export function HostedZoneDetailPage() {
  const { active } = useConnections();
  const params = useParams<{ id: string }>();
  const zoneId = bareZoneId(decodeURIComponent(params.id ?? ""));

  const { data, error: fetchError, loading, reload } = useProfileScopedFetch<DetailData>(
    async (profile) => {
      const [zones, records] = await Promise.all([
        api.route53.listHostedZones(profile),
        api.route53.listRecordSets(profile, zoneId),
      ]);
      const zone = zones.find((z) => bareZoneId(z.id) === zoneId);
      return { zoneName: zone?.name ?? zoneId, records };
    },
    [zoneId],
  );

  const zoneName = data?.zoneName ?? zoneId;
  const records = useMemo(() => data?.records ?? [], [data]);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecordSet | null>(null);
  const [deleting, setDeleting] = useState<RecordSet | null>(null);
  const [busy, setBusy] = useState(false);

  const changeRecord = async (action: "CREATE" | "UPSERT", record: RecordSet) => {
    if (!active) return;
    try {
      await api.route53.changeRecordSet(active, zoneId, action, record);
      setCreating(false);
      setEditing(null);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const columns: Column<RecordSet>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-mono text-[12.5px]",
      render: (r) => <span data-testid={`record-name-${r.name}`}>{r.name}</span>,
    },
    {
      key: "type",
      header: "タイプ",
      render: (r) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{r.recordType}</span>
      ),
    },
    {
      key: "ttl",
      header: "TTL",
      render: (r) => (r.ttl == null ? "-" : r.ttl.toLocaleString()),
    },
    {
      key: "values",
      header: "値",
      render: (r) => (
        <span className="font-mono text-[12px] text-[#5f6b7a]">{r.values.join(", ")}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex gap-2">
          <button
            data-testid={`record-edit-${r.name}`}
            onClick={() => setEditing(r)}
            className="text-[12.5px] font-semibold text-[#0972d3] hover:underline"
          >
            編集
          </button>
          <button
            data-testid={`record-delete-${r.name}`}
            onClick={() => setDeleting(r)}
            className="text-[12.5px] font-semibold text-[#d13212] hover:underline"
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
          title={zoneName}
          count={records.length}
          titleTestId="zone-detail-heading"
          countTestId="records-count"
        >
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="record-create">
            レコードの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={records}
            rowKey={(r) => `${r.recordType}:${r.name}`}
            rowTestId="record-row"
            loading={loading}
            emptyText={fetchError ? undefined : "レコードがありません"}
          />
        </Card>

        {creating && (
          <RecordModal
            zoneName={zoneName}
            onSubmit={(record) => changeRecord("CREATE", record)}
            onClose={() => setCreating(false)}
          />
        )}

        {editing && (
          <RecordModal
            zoneName={zoneName}
            initial={editing}
            onSubmit={(record) => changeRecord("UPSERT", record)}
            onClose={() => setEditing(null)}
          />
        )}

        {deleting && (
          <Modal
            title="レコードの削除"
            onClose={() => setDeleting(null)}
            maxWidth="md"
            footer={
              <ModalFooter
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                  if (!active) return;
                  setBusy(true);
                  try {
                    await api.route53.changeRecordSet(active, zoneId, "DELETE", deleting);
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
                confirmTestId="record-delete-confirm"
                busy={busy}
              />
            }
          >
            <p className="text-sm text-[#5f6b7a]">
              レコード <b className="font-mono text-[#16191f]">{deleting.name}</b>(
              {deleting.recordType})を削除します。
            </p>
          </Modal>
        )}
      </div>
    </ConnectionRequired>
  );
}
