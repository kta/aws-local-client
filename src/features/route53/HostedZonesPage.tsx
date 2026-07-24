import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { HostedZoneSummary } from "../../api/route53";
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
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateZoneModal } from "./CreateZoneModal";

export function HostedZonesPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<HostedZoneSummary[]>((profile) =>
    api.route53.listHostedZones(profile),
  );
  const zones = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<HostedZoneSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createZone = async (name: string) => {
    if (!active) return;
    try {
      await api.route53.createHostedZone(active, name);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedId = selected.size === 1 ? [...selected][0] : null;
  const selectedZone = selectedId ? zones.find((z) => z.id === selectedId) ?? null : null;

  const columns: Column<HostedZoneSummary>[] = [
    {
      key: "name",
      header: "ドメイン名",
      render: (z) => (
        <Link
          to={`/route53/hosted-zones/${encodeURIComponent(z.id)}`}
          data-testid={`zone-link-${z.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {z.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "タイプ",
      render: (z) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {z.privateZone ? "プライベート" : "パブリック"}
        </span>
      ),
    },
    {
      key: "records",
      header: "レコード数",
      render: (z) => (
        <span data-testid={`zone-records-${z.name}`}>{z.recordCount.toLocaleString()}</span>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="ホストゾーン"
          count={zones.length}
          titleTestId="zones-heading"
          countTestId="zones-count"
        >
          <button
            onClick={() => selectedZone && setDeleting(selectedZone)}
            disabled={selected.size !== 1}
            data-testid="zones-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="zones-create">
            ホストゾーンの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={zones}
            rowKey={(z) => z.id}
            loading={loading}
            emptyText={fetchError ? undefined : "ホストゾーンがありません"}
            selection={{
              isSelected: (z) => selected.has(z.id),
              onToggle: (z) => toggle(z.id),
              ariaLabel: (z) => `${z.name} を選択`,
            }}
          />
        </Card>

        {creating && <CreateZoneModal onSubmit={createZone} onClose={() => setCreating(false)} />}

        {deleting && (
          <ConfirmDangerModal
            title="ホストゾーンの削除"
            description={
              <>
                ホストゾーン <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためドメイン名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.route53.deleteHostedZone(active, deleting.id);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="zones-delete-input"
            confirmTestId="zones-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
