import { useState } from "react";
import { toAppError } from "../../api/client";
import { Modal, ModalFooter } from "../../components/ui";

/**
 * Repository delete confirmation: the name must be typed to enable the action,
 * plus a "force" checkbox. Without force, deleting a repository that still holds
 * images is rejected by ECR; with force the images are removed too. An onConfirm
 * rejection is shown inline instead of throwing.
 */
export function DeleteRepositoryModal({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: (force: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(force);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="リポジトリの削除"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={handleConfirm}
          confirmLabel="削除"
          confirmingLabel="削除中..."
          confirmVariant="danger"
          confirmDisabled={text !== name}
          confirmTestId="ecr-delete-confirm"
          busy={busy}
        />
      }
    >
      <p className="mb-3 text-sm text-[#5f6b7a]">
        リポジトリ <b className="font-mono text-[#16191f]">{name}</b>{" "}
        を削除します。確認のためリポジトリ名を入力してください。
      </p>
      <input
        className="w-full rounded border border-[#d9dee3] px-2 py-1 font-mono text-sm"
        data-testid="ecr-delete-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={name}
        autoFocus
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-[#16191f]">
        <input
          type="checkbox"
          data-testid="ecr-delete-force"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
        />
        強制削除(イメージが残っていても削除する)
      </label>
      {error && <div className="mt-2 text-sm text-[#d13212]">{error}</div>}
    </Modal>
  );
}
