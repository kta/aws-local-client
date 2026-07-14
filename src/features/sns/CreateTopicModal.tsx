import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateTopicModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, fifo: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [fifo, setFifo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;
  // FIFO topics require a `.fifo` suffix; preview the effective name.
  const effectiveName = fifo && trimmed && !trimmed.endsWith(".fifo") ? `${trimmed}.fifo` : trimmed;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, fifo);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="トピックの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="t-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>トピック名</span>
          <input
            className={FIELD}
            data-testid="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {fifo && effectiveName && (
            <span className="mt-1 block text-xs text-gray-500" data-testid="t-name-preview">
              作成されるトピック名: {effectiveName}
            </span>
          )}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="t-fifo"
            checked={fifo}
            onChange={(e) => setFifo(e.target.checked)}
          />
          <span className={LABEL_TEXT}>FIFO トピック</span>
        </label>
      </div>
    </Modal>
  );
}
