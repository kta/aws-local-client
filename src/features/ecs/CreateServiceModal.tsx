import { useState } from "react";
import type { TaskDefinitionSummary } from "../../api/ecs";
import { Modal, ModalFooter } from "../../components/ui";

/**
 * Create an ECS service: name, a task definition (chosen from the registered
 * families) and a desired count.
 */
export function CreateServiceModal({
  taskDefs,
  onSubmit,
  onClose,
}: {
  taskDefs: TaskDefinitionSummary[];
  onSubmit: (name: string, taskDef: string, desired: number) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [taskDef, setTaskDef] = useState(taskDefs[0]?.arn ?? "");
  const [desired, setDesired] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && taskDef.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, taskDef, desired);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="サービスの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="csvc-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">サービス名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="csvc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600">タスク定義</span>
          <select
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="csvc-taskdef"
            value={taskDef}
            onChange={(e) => setTaskDef(e.target.value)}
          >
            {taskDefs.length === 0 && <option value="">タスク定義がありません</option>}
            {taskDefs.map((td) => (
              <option key={td.arn} value={td.arn}>
                {td.family}:{td.revision}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-gray-600">希望タスク数</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="csvc-desired"
            value={desired}
            onChange={(e) => setDesired(Number(e.target.value))}
          />
        </label>
      </div>
    </Modal>
  );
}
