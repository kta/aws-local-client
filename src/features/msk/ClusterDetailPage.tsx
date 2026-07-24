import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { BootstrapBrokers, MskClusterSummary } from "../../api/msk";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  ConnectionRequired,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

interface DetailData {
  cluster: MskClusterSummary;
  brokers: BootstrapBrokers;
}

export function ClusterDetailPage() {
  const { name = "" } = useParams<{ name: string }>();
  const [copied, setCopied] = useState(false);

  const { data, error, loading, reload } = useProfileScopedFetch<DetailData>(async (profile) => {
    // The ARN carries slashes/colons that do not survive a route param, so the
    // cluster is resolved by its (unique) name from the list, then described.
    const clusters = await api.msk.listClusters(profile);
    const summary = clusters.find((c) => c.name === name);
    if (!summary) throw { kind: "not_found", message: `クラスターが見つかりません: ${name}` };
    const cluster = await api.msk.describeCluster(profile, summary.arn);
    const brokers = await api.msk.getBootstrapBrokers(profile, summary.arn);
    return { cluster, brokers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; ignore silently (the string stays shown).
    }
  };

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title={name} titleTestId="cluster-detail-heading" />

        <ErrorBanner error={error} onRetry={reload} />

        {loading && !data && <div className="text-sm text-gray-500">読み込み中...</div>}

        {data && (
          <>
            <Card title="概要">
              <dl className="grid grid-cols-[160px_1fr] gap-y-2 p-4 text-sm">
                <dt className="text-gray-600">状態</dt>
                <dd data-testid="cluster-detail-state">
                  <StatusBadge status={data.cluster.state} />
                </dd>
                <dt className="text-gray-600">ブローカー数</dt>
                <dd>{data.cluster.numberOfBrokerNodes ?? "-"}</dd>
                <dt className="text-gray-600">Kafka バージョン</dt>
                <dd>{data.cluster.kafkaVersion ?? "-"}</dd>
                <dt className="text-gray-600">ARN</dt>
                <dd className="break-all font-mono text-[12.5px]">{data.cluster.arn}</dd>
              </dl>
            </Card>

            <div className="mt-4">
              <Card title="ブートストラップブローカー">
                <div className="space-y-3 p-4 text-sm">
                  <div>
                    <div className="mb-1 text-gray-600">プレーンテキスト</div>
                    <div className="flex items-center gap-2">
                      <code
                        data-testid="msk-bootstrap-plaintext"
                        className="min-w-0 flex-1 break-all rounded bg-gray-100 px-2 py-1 font-mono text-[12.5px]"
                      >
                        {data.brokers.plaintext ?? "-"}
                      </code>
                      {data.brokers.plaintext && (
                        <Button
                          variant="secondary"
                          onClick={() => copy(data.brokers.plaintext ?? "")}
                          data-testid="msk-copy-brokers"
                        >
                          {copied ? "コピーしました" : "コピー"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {data.brokers.tls && (
                    <div>
                      <div className="mb-1 text-gray-600">TLS</div>
                      <code
                        data-testid="msk-bootstrap-tls"
                        className="block break-all rounded bg-gray-100 px-2 py-1 font-mono text-[12.5px]"
                      >
                        {data.brokers.tls}
                      </code>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </ConnectionRequired>
  );
}
