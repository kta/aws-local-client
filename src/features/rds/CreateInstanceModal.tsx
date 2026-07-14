import { useState } from "react";
import type { CreateDbInstanceRequest } from "../../api/rds";
import { Modal, ModalFooter } from "../../components/ui";

export function CreateInstanceModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateDbInstanceRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [id, setId] = useState("");
  const [engine, setEngine] = useState("mysql");
  const [instanceClass, setInstanceClass] = useState("db.t3.micro");
  const [masterUsername, setMasterUsername] = useState("");
  // Kept in component state only; never persisted anywhere (secret hygiene).
  const [masterPassword, setMasterPassword] = useState("");
  const [allocatedStorage, setAllocatedStorage] = useState(20);
  const [submitting, setSubmitting] = useState(false);

  const valid =
    id.trim() &&
    instanceClass.trim() &&
    masterUsername.trim() &&
    masterPassword.length > 0 &&
    allocatedStorage > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        id: id.trim(),
        engine,
        instanceClass: instanceClass.trim(),
        masterUsername: masterUsername.trim(),
        masterPassword,
        allocatedStorage,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="データベースを作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="i-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">識別子</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">エンジン</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
          >
            <option value="mysql">mysql</option>
            <option value="postgres">postgres</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">インスタンスクラス</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-class"
            value={instanceClass}
            onChange={(e) => setInstanceClass(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">マスターユーザー名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-username"
            value={masterUsername}
            onChange={(e) => setMasterUsername(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">マスターパスワード</span>
          <input
            type="password"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-password"
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">割り当てストレージ (GB)</span>
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="i-storage"
            value={allocatedStorage}
            onChange={(e) => setAllocatedStorage(Number(e.target.value))}
          />
        </label>
      </div>
    </Modal>
  );
}
