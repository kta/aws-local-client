import { useState } from "react";
import { toAppError } from "../../api/client";
import { Modal, ModalFooter } from "./Modal";

interface ConfirmDangerModalProps {
  title: string;
  description: React.ReactNode;
  requiredText: string; // text that must be typed to enable the action (e.g. table name)
  confirmLabel: string; // e.g. "削除"
  onConfirm: () => Promise<void>; // errors are surfaced inline
  onClose: () => void;
  inputTestId?: string; // e.g. "td-delete-input"
  confirmTestId?: string; // e.g. "td-delete-confirm"
}

/**
 * Name-typed danger confirmation (§2.7). Mirrors the former DeleteTableModal:
 * confirm stays disabled until the typed text matches, and an onConfirm
 * rejection is shown inline instead of throwing.
 */
export function ConfirmDangerModal({
  title,
  description,
  requiredText,
  confirmLabel,
  onConfirm,
  onClose,
  inputTestId,
  confirmTestId,
}: ConfirmDangerModalProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={handleConfirm}
          confirmLabel={confirmLabel}
          confirmingLabel={`${confirmLabel}中...`}
          confirmVariant="danger"
          confirmDisabled={text !== requiredText}
          confirmTestId={confirmTestId}
          busy={busy}
        />
      }
    >
      <p className="mb-3 text-sm text-[#5f6b7a]">{description}</p>
      <input
        className="w-full rounded border border-[#d9dee3] px-2 py-1 font-mono text-sm"
        data-testid={inputTestId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={requiredText}
        autoFocus
      />
      {error && <div className="mt-2 text-sm text-[#d13212]">{error}</div>}
    </Modal>
  );
}
