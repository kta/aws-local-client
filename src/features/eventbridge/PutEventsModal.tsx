import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export interface PutEventsInput {
  source: string;
  detailType: string;
  detail: string;
}

/**
 * "イベントを送信" modal. The target bus is fixed to the bus selected on the
 * rules page; the user supplies source / detail-type / detail (JSON). A rule
 * whose event pattern matches routes the event to its targets (verified in E2E
 * via a real SQS delivery).
 */
export function PutEventsModal({
  bus,
  onSubmit,
  onClose,
}: {
  bus: string;
  onSubmit: (input: PutEventsInput) => Promise<void>;
  onClose: () => void;
}) {
  const [source, setSource] = useState("nlsd.app");
  const [detailType, setDetailType] = useState("appEvent");
  const [detail, setDetail] = useState('{"message":"hello"}');
  const [submitting, setSubmitting] = useState(false);

  // Detail must be valid JSON; EventBridge rejects a non-JSON detail.
  const detailValid = (() => {
    try {
      JSON.parse(detail);
      return true;
    } catch {
      return false;
    }
  })();
  const valid = source.trim().length > 0 && detailType.trim().length > 0 && detailValid;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({ source: source.trim(), detailType: detailType.trim(), detail });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="イベントを送信"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="送信"
          confirmingLabel="送信中..."
          confirmDisabled={!valid}
          confirmTestId="pe-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <div className="text-[12px] text-[#5f6b7a]">
          送信先イベントバス: <span className="font-mono text-[#16191f]">{bus}</span>
        </div>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>source</span>
          <input
            className={FIELD}
            data-testid="pe-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>detail-type</span>
          <input
            className={FIELD}
            data-testid="pe-detail-type"
            value={detailType}
            onChange={(e) => setDetailType(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>detail(JSON)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="pe-detail"
            rows={5}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
          {!detailValid && (
            <span className="mt-1 block text-xs text-[#d13212]" data-testid="pe-detail-invalid">
              detail は有効な JSON である必要があります
            </span>
          )}
        </label>
      </div>
    </Modal>
  );
}
