import { useState } from "react";
import type { CreateQueueRequest } from "../../api/sqs";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateQueueModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateQueueRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [fifo, setFifo] = useState(false);
  const [visibilityTimeout, setVisibilityTimeout] = useState(30);
  const [retentionPeriod, setRetentionPeriod] = useState(345600);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [redrivePolicy, setRedrivePolicy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;
  // FIFO queues require a `.fifo` suffix; preview the effective name.
  const effectiveName = fifo && trimmed && !trimmed.endsWith(".fifo") ? `${trimmed}.fifo` : trimmed;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmed,
        fifo,
        visibilityTimeout,
        retentionPeriod,
        delaySeconds,
        redrivePolicy: redrivePolicy.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="キューの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="q-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>キュー名</span>
          <input
            className={FIELD}
            data-testid="q-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {fifo && effectiveName && (
            <span className="mt-1 block text-xs text-gray-500" data-testid="q-name-preview">
              作成されるキュー名: {effectiveName}
            </span>
          )}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="q-fifo"
            checked={fifo}
            onChange={(e) => setFifo(e.target.checked)}
          />
          <span className={LABEL_TEXT}>FIFO キュー</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>可視性タイムアウト(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="q-visibility"
              value={visibilityTimeout}
              onChange={(e) => setVisibilityTimeout(Number(e.target.value))}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>メッセージ保持期間(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="q-retention"
              value={retentionPeriod}
              onChange={(e) => setRetentionPeriod(Number(e.target.value))}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>配信遅延(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="q-delay"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
          </label>
        </div>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>リドライブポリシー(JSON、任意)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="q-redrive"
            rows={2}
            placeholder='{"deadLetterTargetArn":"...","maxReceiveCount":"5"}'
            value={redrivePolicy}
            onChange={(e) => setRedrivePolicy(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
