import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateApiModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, description?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, description.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="API の作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="api-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>API 名</span>
          <input
            className={FIELD}
            data-testid="api-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>説明(任意)</span>
          <input
            className={FIELD}
            data-testid="api-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
