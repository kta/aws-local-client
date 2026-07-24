import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { DomainSummary } from "../../api/opensearch";
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
import { CreateDomainModal } from "./CreateDomainModal";
import { domainStatusLabel } from "./status";
import { UnsupportedBanner } from "./UnsupportedBanner";

export function DomainsPage() {
  const { active } = useConnections();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DomainSummary[]>((profile) => api.opensearch.listDomains(profile));
  const domains = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Dashboard quick action deep-links here with ?create=1.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      searchParams.delete("create");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // R88: an unsupported load error (kumo) takes over the page and hides create.
  // A create rejection that is NOT an unsupported signature (the describe○/
  // create× middle case) stays a normal error banner while the list renders.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = opError ?? (loadError && !unsupported ? loadError : null);

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const createDomain = async (name: string) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.opensearch.createDomain(active, name);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const columns: Column<DomainSummary>[] = [
    {
      key: "name",
      header: "ドメイン名",
      className: "font-semibold text-[#0972d3]",
      render: (d) => <span data-testid={`opensearch-row-${d.name}`}>{d.name}</span>,
    },
    { key: "engineVersion", header: "エンジンバージョン", render: (d) => d.engineVersion ?? "-" },
    {
      key: "status",
      header: "ステータス",
      render: (d) => <StatusBadge status={domainStatusLabel(d)} />,
    },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (d) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleting(d.name);
          }}
          data-testid="opensearch-delete"
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
          title="ドメイン"
          count={unsupported ? undefined : domains.length}
          titleTestId="opensearch-domains-heading"
          countTestId="opensearch-domains-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="opensearch-create">
              ドメインを作成
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
              rows={domains}
              rowKey={(d) => d.name}
              loading={loading}
              onRowClick={(d) => navigate(`/opensearch/domains/${encodeURIComponent(d.name)}`)}
              emptyText={<span data-testid="opensearch-empty">ドメインがありません</span>}
            />
          </Card>
        )}

        {creating && (
          <CreateDomainModal onSubmit={createDomain} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ドメインの削除"
            description={
              <>
                ドメイン <b className="font-mono text-[#16191f]">{deleting}</b>{" "}
                を削除します。確認のためドメイン名を入力してください。
              </>
            }
            requiredText={deleting}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.opensearch.deleteDomain(active, deleting);
              setDeleting(null);
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="opensearch-delete-input"
            confirmTestId="opensearch-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
