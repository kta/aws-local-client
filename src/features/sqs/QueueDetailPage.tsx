import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { QueueDetail, SendMessageRequest, SqsMessage } from "../../api/sqs";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConfirmDangerModal, ConnectionRequired } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { SendMessageModal } from "./SendMessageModal";

type Tab = "messages" | "settings";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function QueueDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { active } = useConnections();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<QueueDetail>(async (profile) => {
    // Resolve the queue URL from its name (reload-resilient: no reliance on
    // navigation state), then load full attributes.
    const list = await api.sqs.listQueues(profile);
    const summary = list.find((q) => q.name === name);
    if (!summary) throw { kind: "not_found", message: `queue ${name} not found` } as AppError;
    return api.sqs.getQueue(profile, summary.queueUrl);
  }, [name]);

  const [tab, setTab] = useState<Tab>("messages");
  const [messages, setMessages] = useState<SqsMessage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [purging, setPurging] = useState(false);
  const [polling, setPolling] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const queueUrl = detail?.queueUrl ?? "";

  const poll = async () => {
    if (!active || !queueUrl) return;
    setPolling(true);
    setActionError(null);
    try {
      const received = await api.sqs.receiveMessages(active, queueUrl);
      // Merge, de-duplicating by messageId so repeated polls do not duplicate rows.
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.messageId, m]));
        for (const m of received) byId.set(m.messageId, m);
        return [...byId.values()];
      });
    } catch (e) {
      setActionError(toAppError(e));
    } finally {
      setPolling(false);
    }
  };

  const send = async (req: SendMessageRequest) => {
    if (!active || !queueUrl) return;
    try {
      await api.sqs.sendMessage(active, queueUrl, req);
      setSending(false);
      setActionError(null);
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const deleteSelected = async () => {
    if (!active || !queueUrl || selected.size === 0) return;
    setActionError(null);
    try {
      const targets = messages.filter((m) => selected.has(m.messageId));
      for (const m of targets) {
        await api.sqs.deleteMessage(active, queueUrl, m.receiptHandle);
      }
      const removed = new Set(targets.map((m) => m.messageId));
      setMessages((prev) => prev.filter((m) => !removed.has(m.messageId)));
      setSelected(new Set());
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/sqs/queues" className="font-semibold text-[#0972d3] hover:underline">
            キュー
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold">{name}</h1>
          {detail && (
            <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
              {detail.fifo ? "FIFO" : "Standard"}
            </span>
          )}
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button
            onClick={() => setTab("messages")}
            data-testid="tab-messages"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "messages" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            メッセージ
          </button>
          <button
            onClick={() => setTab("settings")}
            data-testid="tab-settings"
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
              tab === "settings" ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
            }`}
          >
            設定
          </button>
        </div>

        {tab === "messages" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => setSending(true)}
                data-testid="queue-send"
                disabled={!detail}
              >
                メッセージの送信
              </Button>
              <Button onClick={poll} data-testid="queue-poll" disabled={!detail || polling}>
                {polling ? "ポーリング中..." : "メッセージをポーリング"}
              </Button>
              <div className="flex-1" />
              <button
                onClick={deleteSelected}
                disabled={selected.size === 0}
                data-testid="msg-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                選択したメッセージを削除
              </button>
              <button
                onClick={() => setPurging(true)}
                data-testid="queue-purge"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
              >
                パージ
              </button>
            </div>

            <Card className="overflow-x-auto">
              <table
                data-testid="messages-table"
                className="w-full border-collapse [font-variant-numeric:tabular-nums]"
              >
                <thead>
                  <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                    <th className="w-9" />
                    <th>メッセージ ID</th>
                    <th>本文</th>
                    <th>送信日時</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                        メッセージがありません。「メッセージをポーリング」で受信します。
                      </td>
                    </tr>
                  )}
                  {messages.map((m) => (
                    <Fragment key={m.messageId}>
                      <tr
                        data-testid={`msg-row-${m.messageId}`}
                        onClick={() => toggleExpand(m.messageId)}
                        className="cursor-pointer [&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]"
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`${m.messageId} を選択`}
                            checked={selected.has(m.messageId)}
                            onChange={() => toggleSelect(m.messageId)}
                          />
                        </td>
                        <td className="font-mono text-xs">{m.messageId}</td>
                        <td className="max-w-[320px] truncate font-mono text-xs">{m.body}</td>
                        <td className="text-xs text-[#5f6b7a]">{formatDate(m.sentAt)}</td>
                      </tr>
                      {expanded.has(m.messageId) && (
                        <tr>
                          <td colSpan={4} className="border-b border-[#e9ecef] bg-[#fafbfc] px-[14px] py-3">
                            <pre
                              data-testid={`msg-body-${m.messageId}`}
                              className="whitespace-pre-wrap break-all font-mono text-xs text-[#16191f]"
                            >
                              {m.body}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {tab === "settings" && detail && active && (
          <SettingsTab
            detail={detail}
            profile={active}
            onSaved={reload}
            onError={setActionError}
          />
        )}

        {sending && detail && (
          <SendMessageModal fifo={detail.fifo} onSubmit={send} onClose={() => setSending(false)} />
        )}

        {purging && detail && (
          <ConfirmDangerModal
            title="キューのパージ"
            description={
              <>
                キュー <b className="font-mono text-[#16191f]">{detail.name}</b>{" "}
                内のすべてのメッセージを削除します。確認のためキュー名を入力してください。
              </>
            }
            requiredText={detail.name}
            confirmLabel="パージ"
            onConfirm={async () => {
              if (!active) return;
              await api.sqs.purgeQueue(active, detail.queueUrl);
              setMessages([]);
              setSelected(new Set());
              setPurging(false);
            }}
            onClose={() => setPurging(false)}
            inputTestId="queue-purge-input"
            confirmTestId="queue-purge-confirm"
          />
        )}

        {tab === "messages" && detail && (
          <div className="mt-2 text-[12px] text-[#5f6b7a]">
            {detail.approximateMessages.toLocaleString()} 件のメッセージ(概算) /{" "}
            {detail.approximateNotVisible.toLocaleString()} 件処理中
          </div>
        )}
      </div>
    </ConnectionRequired>
  );
}

function SettingsTab({
  detail,
  profile,
  onSaved,
  onError,
}: {
  detail: QueueDetail;
  profile: ConnectionProfile;
  onSaved: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  const [visibilityTimeout, setVisibilityTimeout] = useState(detail.visibilityTimeout);
  const [retentionPeriod, setRetentionPeriod] = useState(detail.retentionPeriod);
  const [delaySeconds, setDelaySeconds] = useState(detail.delaySeconds);
  const [redrivePolicy, setRedrivePolicy] = useState(detail.redrivePolicy ?? "");
  const [saving, setSaving] = useState(false);

  // Reset the form when a fresh detail (re)loads.
  useEffect(() => {
    setVisibilityTimeout(detail.visibilityTimeout);
    setRetentionPeriod(detail.retentionPeriod);
    setDelaySeconds(detail.delaySeconds);
    setRedrivePolicy(detail.redrivePolicy ?? "");
  }, [detail]);

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.sqs.setQueueAttributes(profile, detail.queueUrl, {
        visibilityTimeout,
        retentionPeriod,
        delaySeconds,
        redrivePolicy: redrivePolicy.trim() || undefined,
      });
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="キュー設定" overflowHidden>
        <div className="space-y-3 p-4">
          <div className="text-[12px] text-[#5f6b7a]">
            ARN: <span className="font-mono">{detail.arn}</span>
            {detail.createdAt && <> / 作成: {formatDate(detail.createdAt)}</>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              <span className={LABEL_TEXT}>可視性タイムアウト(秒)</span>
              <input
                type="number"
                className={FIELD}
                data-testid="qs-visibility"
                value={visibilityTimeout}
                onChange={(e) => setVisibilityTimeout(Number(e.target.value))}
              />
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>メッセージ保持期間(秒)</span>
              <input
                type="number"
                className={FIELD}
                data-testid="qs-retention"
                value={retentionPeriod}
                onChange={(e) => setRetentionPeriod(Number(e.target.value))}
              />
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>配信遅延(秒)</span>
              <input
                type="number"
                className={FIELD}
                data-testid="qs-delay"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
              />
            </label>
          </div>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>リドライブポリシー(JSON、任意)</span>
            <textarea
              className={`${FIELD} font-mono text-xs`}
              data-testid="qs-redrive"
              rows={2}
              value={redrivePolicy}
              onChange={(e) => setRedrivePolicy(e.target.value)}
            />
          </label>
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={saving} data-testid="qs-save">
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </Card>
  );
}
