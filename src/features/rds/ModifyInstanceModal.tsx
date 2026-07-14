import { useState } from "react";
import type { DbInstanceSummary, ModifyInstanceRequest } from "../../api/rds";
import { Modal, ModalFooter } from "../../components/ui";

export function ModifyInstanceModal({
  instance,
  onSubmit,
  onClose,
}: {
  instance: DbInstanceSummary;
  onSubmit: (req: ModifyInstanceRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [instanceClass, setInstanceClass] = useState(instance.instanceClass);
  const [allocatedStorage, setAllocatedStorage] = useState(instance.allocatedStorage ?? 20);
  const [submitting, setSubmitting] = useState(false);

  const valid = instanceClass.trim() && allocatedStorage > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      // Only send fields that actually changed so a no-op modify stays a no-op.
      const req: ModifyInstanceRequest = {};
      if (instanceClass.trim() !== instance.instanceClass) req.instanceClass = instanceClass.trim();
      if (allocatedStorage !== instance.allocatedStorage) req.allocatedStorage = allocatedStorage;
      await onSubmit(req);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="データベースの変更"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="変更"
          confirmingLabel="変更中..."
          confirmDisabled={!valid}
          confirmTestId="m-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          <b className="font-mono text-[#16191f]">{instance.id}</b> を変更します(即時適用)。
        </p>
        <label className="block text-sm">
          <span className="text-gray-600">インスタンスクラス</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="m-class"
            value={instanceClass}
            onChange={(e) => setInstanceClass(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">割り当てストレージ (GB)</span>
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="m-storage"
            value={allocatedStorage}
            onChange={(e) => setAllocatedStorage(Number(e.target.value))}
          />
        </label>
      </div>
    </Modal>
  );
}
