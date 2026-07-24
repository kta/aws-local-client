import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { DomainDetail } from "../../api/opensearch";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Card, ConnectionRequired, StatusBadge } from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { domainStatusLabel } from "./status";

export function DomainDetailPage() {
  const { name } = useParams<{ name: string }>();
  const {
    data: domain,
    error,
    reload,
  } = useProfileScopedFetch<DomainDetail>(
    (profile) => api.opensearch.getDomain(profile, name ?? ""),
    [name],
  );

  const rows: { label: string; value: React.ReactNode; testId?: string }[] = domain
    ? [
        { label: "ドメイン名", value: domain.name },
        {
          label: "ステータス",
          value: <StatusBadge status={domainStatusLabel(domain)} />,
          testId: "os-detail-status",
        },
        {
          label: "エンジンバージョン",
          value: domain.engineVersion ?? "-",
          testId: "os-detail-engine",
        },
        {
          label: "エンドポイント",
          value: (
            <span className="font-mono text-xs" data-testid="os-detail-endpoint">
              {domain.endpoint ?? "-"}
            </span>
          ),
        },
        {
          label: "作成状況",
          value: domain.created ? "作成済み" : "作成中",
        },
      ]
    : [];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/opensearch/domains" className="font-semibold text-[#0972d3] hover:underline">
            ドメイン
          </Link>
          {" / "}
          {name}
        </div>
        <h1 className="mb-4 text-[20px] font-bold" data-testid="os-detail-heading">
          {name}
        </h1>

        <ErrorBanner error={error} onRetry={reload} />

        {domain && (
          <Card title="詳細" overflowHidden>
            <table className="w-full border-collapse [font-variant-numeric:tabular-nums]">
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.label}
                    className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
                  >
                    <td className="w-[220px] text-[12.5px] font-semibold text-[#5f6b7a]">
                      {r.label}
                    </td>
                    <td className="break-all" data-testid={r.testId}>
                      {r.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </ConnectionRequired>
  );
}
