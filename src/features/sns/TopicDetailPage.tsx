import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { PublishRequest, SnsSubscription, TopicSummary } from "../../api/sns";
import type { QueueSummary } from "../../api/sqs";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  ConfirmDangerModal,
  ConnectionRequired,
  Modal,
  ModalFooter,
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

type Tab = "subs" | "publish";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

/** The queue name is the last colon-separated segment of an SQS endpoint ARN. */
function queueNameFromEndpoint(endpoint: string): string {
  return endpoint.split(":").pop() || endpoint;
}

export function TopicDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { active } = useConnections();
  const {
    data: topic,
    error,
    reload,
  } = useProfileScopedFetch<TopicSummary>(async (profile) => {
    // Resolve the topic ARN from its name (reload-resilient: no reliance on
    // navigation state).
    const list = await api.sns.listTopics(profile);
    const summary = list.find((t) => t.name === name);
    if (!summary) throw { kind: "not_found", message: `topic ${name} not found` } as AppError;
    return summary;
  }, [name]);

  const [tab, setTab] = useState<Tab>("subs");

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/sns/topics" className="font-semibold text-[#0972d3] hover:underline">
            トピック
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold">{name}</h1>
          {topic && (
            <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
              {topic.fifo ? "FIFO" : "Standard"}
            </span>
          )}
        </div>

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button
            onClick={() => setTab("subs")}
            data-testid="tab-subs"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "subs" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            サブスクリプション
          </button>
          <button
            onClick={() => setTab("publish")}
            data-testid="tab-publish"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "publish" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            メッセージの発行
          </button>
        </div>

        {tab === "subs" && topic && active && (
          <SubscriptionsTab topic={topic} profile={active} />
        )}

        {tab === "publish" && topic && active && (
          <PublishTab topic={topic} profile={active} />
        )}
      </div>
    </ConnectionRequired>
  );
}

function SubscriptionsTab({
  topic,
  profile,
}: {
  topic: TopicSummary;
  profile: ConnectionProfile;
}) {
  const {
    data,
    error,
    reload,
  } = useProfileScopedFetch<SnsSubscription[]>(
    (p) => api.sns.listSubscriptions(p, topic.topicArn),
    [topic.topicArn],
  );
  const subs = data ?? [];
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SnsSubscription | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="primary" onClick={() => setAdding(true)} data-testid="sub-add">
          サブスクリプションの追加
        </Button>
      </div>

      <ErrorBanner error={actionError ?? error} onRetry={reload} />

      <Card className="overflow-x-auto">
        <table
          data-testid="subs-table"
          className="w-full border-collapse [font-variant-numeric:tabular-nums]"
        >
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>プロトコル</th>
              <th>エンドポイント</th>
              <th>Raw 配信</th>
              <th>フィルター</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-[#5f6b7a]">
                  サブスクリプションがありません
                </td>
              </tr>
            )}
            {subs.map((s) => (
              <tr
                key={s.subscriptionArn}
                data-testid={`sub-row-${queueNameFromEndpoint(s.endpoint)}`}
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
              >
                <td className="text-xs font-semibold">{s.protocol}</td>
                <td className="font-mono text-xs">{s.endpoint}</td>
                <td className="text-xs">{s.rawDelivery ? "有効" : "無効"}</td>
                <td className="max-w-[240px] truncate font-mono text-xs text-[#5f6b7a]">
                  {s.filterPolicy ?? "-"}
                </td>
                <td>
                  <button
                    onClick={() => setRemoving(s)}
                    data-testid="sub-remove"
                    className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[12px] py-[4px] text-[12.5px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
                  >
                    解除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {adding && (
        <SubscribeModal
          topic={topic}
          profile={profile}
          onDone={async () => {
            setAdding(false);
            setActionError(null);
            await reload();
          }}
          onError={setActionError}
          onClose={() => setAdding(false)}
        />
      )}

      {removing && (
        <ConfirmDangerModal
          title="サブスクリプションの解除"
          description={
            <>
              エンドポイント{" "}
              <b className="font-mono text-[#16191f]">{queueNameFromEndpoint(removing.endpoint)}</b>{" "}
              のサブスクリプションを解除します。確認のためキュー名を入力してください。
            </>
          }
          requiredText={queueNameFromEndpoint(removing.endpoint)}
          confirmLabel="解除"
          onConfirm={async () => {
            await api.sns.unsubscribe(profile, removing.subscriptionArn);
            setRemoving(null);
            await reload();
          }}
          onClose={() => setRemoving(null)}
          inputTestId="sub-remove-input"
          confirmTestId="sub-remove-confirm"
        />
      )}
    </div>
  );
}

function SubscribeModal({
  topic,
  profile,
  onDone,
  onError,
  onClose,
}: {
  topic: TopicSummary;
  profile: ConnectionProfile;
  onDone: () => Promise<void>;
  onError: (e: AppError | null) => void;
  onClose: () => void;
}) {
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [queueUrl, setQueueUrl] = useState("");
  const [filterPolicy, setFilterPolicy] = useState("");
  const [rawDelivery, setRawDelivery] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.sqs
      .listQueues(profile)
      .then((qs) => {
        if (cancelled) return;
        setQueues(qs);
        if (qs.length > 0) setQueueUrl(qs[0].queueUrl);
      })
      .catch((e) => onError(toAppError(e)));
    return () => {
      cancelled = true;
    };
  }, [profile, onError]);

  const valid = queueUrl.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      // Resolve the selected queue's ARN, which SNS needs as the endpoint.
      const detail = await api.sqs.getQueue(profile, queueUrl);
      await api.sns.subscribeSqs(
        profile,
        topic.topicArn,
        detail.arn,
        filterPolicy.trim() || null,
        rawDelivery,
      );
      await onDone();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="サブスクリプションの追加"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="追加"
          confirmingLabel="追加中..."
          confirmDisabled={!valid}
          confirmTestId="sub-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>キュー(SQS)</span>
          <select
            className={FIELD}
            data-testid="sub-queue-select"
            value={queueUrl}
            onChange={(e) => setQueueUrl(e.target.value)}
          >
            {queues.length === 0 && <option value="">キューがありません</option>}
            {queues.map((q) => (
              <option key={q.queueUrl} value={q.queueUrl}>
                {q.name}
              </option>
            ))}
          </select>
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>フィルターポリシー(JSON、任意)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="sub-filter"
            rows={2}
            placeholder='{"event":["order_created"]}'
            value={filterPolicy}
            onChange={(e) => setFilterPolicy(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="sub-raw"
            checked={rawDelivery}
            onChange={(e) => setRawDelivery(e.target.checked)}
          />
          <span className={LABEL_TEXT}>Raw メッセージ配信</span>
        </label>
      </div>
    </Modal>
  );
}

interface AttrRow {
  name: string;
  dataType: string;
  value: string;
}

function PublishTab({
  topic,
  profile,
}: {
  topic: TopicSummary;
  profile: ConnectionProfile;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [groupId, setGroupId] = useState("");
  const [dedupId, setDedupId] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  // FIFO topics require a MessageGroupId.
  const valid = message.trim().length > 0 && (!topic.fifo || groupId.trim().length > 0);

  const publish = async () => {
    if (!valid) return;
    setPublishing(true);
    setActionError(null);
    try {
      // Rows without a name are excluded from the request.
      const attributes = attrs
        .filter((a) => a.name.trim())
        .reduce<Record<string, { dataType: string; stringValue: string }>>((acc, a) => {
          acc[a.name.trim()] = { dataType: a.dataType || "String", stringValue: a.value };
          return acc;
        }, {});
      const req: PublishRequest = {
        message,
        subject: subject.trim() || undefined,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        groupId: topic.fifo ? groupId.trim() : undefined,
        dedupId: topic.fifo ? dedupId.trim() || undefined : undefined,
      };
      const messageId = await api.sns.publish(profile, topic.topicArn, req);
      setResult(messageId);
    } catch (e) {
      setActionError(toAppError(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card title="メッセージの発行" overflowHidden>
      <div className="space-y-3 p-4">
        <ErrorBanner error={actionError} />

        <label className={LABEL}>
          <span className={LABEL_TEXT}>件名(任意)</span>
          <input
            className={FIELD}
            data-testid="pub-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>メッセージ</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="pub-message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>

        {topic.fifo && (
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              <span className={LABEL_TEXT}>メッセージグループ ID</span>
              <input
                className={FIELD}
                data-testid="pub-group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              />
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>重複排除 ID(任意)</span>
              <input
                className={FIELD}
                data-testid="pub-dedup-id"
                value={dedupId}
                onChange={(e) => setDedupId(e.target.value)}
              />
            </label>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">メッセージ属性</span>
            <button
              className="text-sm text-blue-600 hover:underline"
              data-testid="pub-add-attr"
              onClick={() => setAttrs([...attrs, { name: "", dataType: "String", value: "" }])}
            >
              + 属性を追加
            </button>
          </div>
          {attrs.map((a, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <input
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                placeholder="名前"
                data-testid={`pub-attr-name-${i}`}
                value={a.name}
                onChange={(e) =>
                  setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                data-testid={`pub-attr-type-${i}`}
                value={a.dataType}
                onChange={(e) =>
                  setAttrs(attrs.map((x, j) => (j === i ? { ...x, dataType: e.target.value } : x)))
                }
              >
                <option>String</option>
                <option>Number</option>
                <option>Binary</option>
              </select>
              <input
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                placeholder="値"
                data-testid={`pub-attr-value-${i}`}
                value={a.value}
                onChange={(e) =>
                  setAttrs(attrs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
              />
              <button
                className="text-sm text-red-600 hover:underline"
                onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          {result ? (
            <span className="text-[13px] font-semibold text-[#037f51]" data-testid="publish-result">
              発行しました (MessageId: {result})
            </span>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            onClick={publish}
            disabled={!valid || publishing}
            data-testid="pub-save"
          >
            {publishing ? "発行中..." : "発行"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
