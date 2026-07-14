import { useState } from "react";
import type { SendMessageRequest } from "../../api/sqs";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

interface AttrRow {
  name: string;
  dataType: string;
  value: string;
}

export function SendMessageModal({
  fifo,
  onSubmit,
  onClose,
}: {
  fifo: boolean;
  onSubmit: (req: SendMessageRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [dedupId, setDedupId] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // FIFO queues require a MessageGroupId.
  const valid = body.trim().length > 0 && (!fifo || groupId.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const attributes = attrs
        .filter((a) => a.name.trim())
        .reduce<Record<string, { dataType: string; stringValue: string }>>((acc, a) => {
          acc[a.name.trim()] = { dataType: a.dataType || "String", stringValue: a.value };
          return acc;
        }, {});
      await onSubmit({
        body,
        delaySeconds: fifo ? undefined : delaySeconds,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        groupId: fifo ? groupId.trim() : undefined,
        dedupId: fifo ? dedupId.trim() || undefined : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="メッセージの送信"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="送信"
          confirmingLabel="送信中..."
          confirmDisabled={!valid}
          confirmTestId="sm-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>本文</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="sm-body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        {!fifo && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>配信遅延(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="sm-delay"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
          </label>
        )}

        {fifo && (
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              <span className={LABEL_TEXT}>メッセージグループ ID</span>
              <input
                className={FIELD}
                data-testid="sm-group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              />
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>重複排除 ID(任意)</span>
              <input
                className={FIELD}
                data-testid="sm-dedup-id"
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
              data-testid="sm-add-attr"
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
                data-testid={`sm-attr-name-${i}`}
                value={a.name}
                onChange={(e) =>
                  setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                data-testid={`sm-attr-type-${i}`}
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
                data-testid={`sm-attr-value-${i}`}
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
      </div>
    </Modal>
  );
}
