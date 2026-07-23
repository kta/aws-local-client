import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

export function CreateRepositoryModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="リポジトリの作成"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="ecr-save"
          busy={submitting}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">リポジトリ名</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="ecr-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-repository"
          autoFocus
        />
      </label>
    </Modal>
  );
}
