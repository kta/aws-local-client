import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { UserPoolSummary } from "../../api/cognito";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
  SummaryCards,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { UnsupportedBanner } from "./UnsupportedBanner";

interface DashboardData {
  pools: UserPoolSummary[];
  // Total user count across all pools (best-effort per describe).
  totalUsers: number;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DashboardData>(async (profile) => {
    const pools = await api.cognito.listUserPools(profile);
    let totalUsers = 0;
    for (const p of pools) {
      try {
        totalUsers += (await api.cognito.getUserPool(profile, p.id)).estimatedUsers;
      } catch {
        // best effort: a describe failure must not fail the whole dashboard.
      }
    }
    return { pools, totalUsers };
  });

  const pools = useMemo(() => data?.pools ?? [], [data]);
  const totalUsers = data?.totalUsers ?? 0;

  // R60: an unsupported list takes over the page with the cognito-unsupported
  // banner; any other error stays a normal error banner.
  const unsupported = loadError && isUnsupportedOperation(loadError) ? loadError : null;
  const error = loadError && !unsupported ? loadError : null;

  const columns: Column<UserPoolSummary>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (p) => p.name,
    },
    { key: "id", header: "プール ID", render: (p) => <span className="font-mono text-xs">{p.id}</span> },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ダッシュボード" titleTestId="cognito-dashboard-heading" />

        {unsupported && <UnsupportedBanner message={unsupported.message} />}

        <ErrorBanner error={error} onRetry={reload} />

        {!unsupported && (
          <>
            <div className="mb-[14px]">
              <SummaryCards
                testId="cognito-dashboard-summary"
                items={[
                  {
                    label: "ユーザープール数",
                    value: String(pools.length),
                    testId: "cognito-dash-pools",
                  },
                  {
                    label: "総ユーザー数",
                    value: String(totalUsers),
                    testId: "cognito-dash-users",
                  },
                ]}
              />
            </div>

            <div className="mb-[14px] flex flex-wrap gap-[10px]">
              <Button
                variant="primary"
                onClick={() => navigate("/cognito/user-pools?create=1")}
                data-testid="cognito-dash-create"
              >
                ユーザープールを作成
              </Button>
            </div>

            <Card title="ユーザープール" overflowHidden>
              <DataTable
                variant="list"
                columns={columns}
                rows={pools}
                rowKey={(p) => p.id}
                rowTestId="cognito-dash-table"
                loading={loading}
                emptyText={
                  <span data-testid="cognito-dash-empty">ユーザープールがありません</span>
                }
                onRowClick={(p) => navigate(`/cognito/user-pools/${encodeURIComponent(p.id)}`)}
              />
            </Card>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
