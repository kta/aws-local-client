import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function StartExecutionModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (input: string) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState('{\n  "hello": "world"\n}');
  const [submitting, setSubmitting] = useState(false);

  // Input must be valid JSON (Step Functions rejects malformed input).
  let jsonError: string | null = null;
  try {
    JSON.parse(input);
  } catch (e) {
    jsonError = e instanceof Error ? e.message : String(e);
  }
  const valid = !jsonError;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(input);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="実行の開始"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="実行を開始"
          confirmingLabel="開始中..."
          confirmDisabled={!valid}
          confirmTestId="exec-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>入力(JSON)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="exec-input"
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {jsonError && (
            <span className="mt-1 block text-xs text-red-600" data-testid="exec-input-error">
              JSON エラー: {jsonError}
            </span>
          )}
        </label>
      </div>
    </Modal>
  );
}
