import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

/** A minimal Pass-state ASL used as the create form's starting point. */
export const DEFAULT_ASL = JSON.stringify(
  { StartAt: "P", States: { P: { Type: "Pass", End: true } } },
  null,
  2,
);

export function CreateStateMachineModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, definition: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(DEFAULT_ASL);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  // The definition must be non-empty valid JSON (ASL). Preview any parse error.
  let jsonError: string | null = null;
  try {
    JSON.parse(definition);
  } catch (e) {
    jsonError = e instanceof Error ? e.message : String(e);
  }
  const valid = trimmed.length > 0 && !jsonError;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, definition);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ステートマシンの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="sm-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>名前</span>
          <input
            className={FIELD}
            data-testid="sm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>定義(Amazon States Language / JSON)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="sm-definition"
            rows={12}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
          />
          {jsonError && (
            <span className="mt-1 block text-xs text-red-600" data-testid="sm-definition-error">
              JSON エラー: {jsonError}
            </span>
          )}
        </label>

        <p className="text-xs text-gray-500">
          IAM ロールはローカルエミュレータ用のダミー ARN が自動的に設定されます。
        </p>
      </div>
    </Modal>
  );
}
