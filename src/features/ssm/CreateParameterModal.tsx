import { useState } from "react";
import type { ParameterType, PutParameterRequest } from "../../api/ssm";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateParameterModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: PutParameterRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ParameterType>("String");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && value.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        value,
        type,
        overwrite: false,
        description: description.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="パラメータの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="param-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>名前(例: /app/db/password)</span>
          <input
            className={FIELD}
            data-testid="param-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>タイプ</span>
          <select
            className={FIELD}
            data-testid="param-type"
            value={type}
            onChange={(e) => setType(e.target.value as ParameterType)}
          >
            <option value="String">String</option>
            <option value="StringList">StringList</option>
            <option value="SecureString">SecureString</option>
          </select>
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>値</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="param-value"
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {type === "StringList" && (
            <span className="mt-1 block text-xs text-gray-500">
              StringList はカンマ区切りで複数の値を指定します。
            </span>
          )}
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>説明(任意)</span>
          <input
            className={FIELD}
            data-testid="param-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
