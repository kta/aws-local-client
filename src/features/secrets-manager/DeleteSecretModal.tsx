import { useState } from "react";
import { toAppError } from "../../api/client";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";

/**
 * Secret deletion with the recovery-window vs. immediate (force) choice.
 * Recovery-window deletion is supported by all four probed emulators, so the
 * choice is always offered; the confirm stays disabled until the secret name
 * is typed (name-typed danger confirmation, §2.7).
 */
export function DeleteSecretModal({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: (force: boolean, recoveryDays: number) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"recovery" | "force">("recovery");
  const [recoveryDays, setRecoveryDays] = useState(30);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(mode === "force", recoveryDays);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="シークレットの削除"
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
          confirmTestId="secrets-delete-confirm"
          busy={busy}
        />
      }
    >
      <p className="mb-3 text-sm text-[#5f6b7a]">
        シークレット <b className="font-mono text-[#16191f]">{name}</b>{" "}
        を削除します。削除方法を選択し、確認のためシークレット名を入力してください。
      </p>

      <div className="mb-3 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="delete-mode"
            data-testid="secrets-delete-mode-recovery"
            checked={mode === "recovery"}
            onChange={() => setMode("recovery")}
          />
          <span>猶予期間を設けて削除(復元可能)</span>
        </label>
        {mode === "recovery" && (
          <label className="block pl-6 text-xs text-gray-600">
            復元猶予日数(7〜30)
            <input
              type="number"
              min={7}
              max={30}
              className={FIELD}
              data-testid="secrets-delete-recovery-days"
              value={recoveryDays}
              onChange={(e) => setRecoveryDays(Number(e.target.value))}
            />
          </label>
        )}
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="delete-mode"
            data-testid="secrets-delete-mode-force"
            checked={mode === "force"}
            onChange={() => setMode("force")}
          />
          <span>即時削除(復元不可)</span>
        </label>
      </div>

      <input
        className="w-full rounded border border-[#d9dee3] px-2 py-1 font-mono text-sm"
        data-testid="secrets-delete-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={name}
        autoFocus
      />
      {error && <div className="mt-2 text-sm text-[#d13212]">{error}</div>}
    </Modal>
  );
}
