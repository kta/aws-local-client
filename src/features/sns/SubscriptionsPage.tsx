import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { GlobalSubscription } from "../../api/sns";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Card, ConfirmDangerModal, ConnectionRequired, PageHeader } from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

/** The last colon-separated segment of an endpoint ARN (falls back to the whole value). */
function endpointLabel(endpoint: string): string {
  return endpoint.split(":").pop() || endpoint;
}

/** Confirmed subscriptions carry a real ARN; pending ones cannot be unsubscribed. */
function isConfirmed(sub: GlobalSubscription): boolean {
  return sub.subscriptionArn.startsWith("arn:");
}

export function SubscriptionsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<GlobalSubscription[]>((profile) => api.sns.listAllSubscriptions(profile));
  const subs = data ?? [];
  const [removing, setRemoving] = useState<GlobalSubscription | null>(null);

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="サブスクリプション"
          count={subs.length}
          titleTestId="subscriptions-heading"
          countTestId="subscriptions-count"
        />

        <ErrorBanner error={fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <table
            data-testid="subscriptions-table"
            className="w-full border-collapse [font-variant-numeric:tabular-nums]"
          >
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                <th>トピック</th>
                <th>プロトコル</th>
                <th>エンドポイント</th>
                <th>ARN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-[#5f6b7a]">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!loading && subs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-[#5f6b7a]">
                    {fetchError ? "" : "サブスクリプションがありません"}
                  </td>
                </tr>
              )}
              {!loading &&
                subs.map((s) => {
                  const confirmed = isConfirmed(s);
                  return (
                    <tr
                      key={s.subscriptionArn + s.topicArn + s.endpoint}
                      data-testid={`gsub-row-${s.topicName}`}
                      className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
                    >
                      <td>
                        <Link
                          to={`/sns/topics/${encodeURIComponent(s.topicName)}`}
                          data-testid={`gsub-topic-link-${s.topicName}`}
                          className="font-semibold text-[#0972d3] no-underline hover:underline"
                        >
                          {s.topicName}
                        </Link>
                      </td>
                      <td className="text-xs font-semibold">{s.protocol}</td>
                      <td className="font-mono text-xs">{s.endpoint}</td>
                      <td className="max-w-[280px] truncate font-mono text-xs text-[#5f6b7a]">
                        {confirmed ? s.subscriptionArn : "保留中(確認待ち)"}
                      </td>
                      <td>
                        <button
                          onClick={() => confirmed && setRemoving(s)}
                          disabled={!confirmed}
                          title={confirmed ? undefined : "確認待ちのサブスクリプションは解除できません"}
                          data-testid="gsub-remove"
                          className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[12px] py-[4px] text-[12.5px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          解除
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Card>

        {removing && (
          <ConfirmDangerModal
            title="サブスクリプションの解除"
            description={
              <>
                トピック <b className="font-mono text-[#16191f]">{removing.topicName}</b> のエンドポイント{" "}
                <b className="font-mono text-[#16191f]">{endpointLabel(removing.endpoint)}</b>{" "}
                のサブスクリプションを解除します。確認のためエンドポイント名を入力してください。
              </>
            }
            requiredText={endpointLabel(removing.endpoint)}
            confirmLabel="解除"
            onConfirm={async () => {
              if (!active) return;
              await api.sns.unsubscribe(active, removing.subscriptionArn);
              setRemoving(null);
              await reload();
            }}
            onClose={() => setRemoving(null)}
            inputTestId="gsub-remove-input"
            confirmTestId="gsub-remove-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
