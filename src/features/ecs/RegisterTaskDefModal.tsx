import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const DEFAULT_CONTAINERS = `[
  {
    "name": "app",
    "image": "public.ecr.aws/docker/library/busybox:stable",
    "memory": 128,
    "essential": true,
    "command": ["sleep", "60"]
  }
]`;

/**
 * Register a task definition from a family name + a containerDefinitions JSON
 * array. Only name/image/memory/cpu/essential/command are mapped onto the SDK
 * request; other keys are accepted but ignored (the page notes them after a
 * successful register).
 */
export function RegisterTaskDefModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (family: string, containerDefsJson: string) => Promise<void>;
  onClose: () => void;
}) {
  const [family, setFamily] = useState("");
  const [json, setJson] = useState(DEFAULT_CONTAINERS);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = family.trim();
  const valid = trimmed.length > 0 && json.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, json);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="タスク定義の登録"
      onClose={onClose}
      maxWidth="2xl"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="登録"
          confirmingLabel="登録中..."
          confirmDisabled={!valid}
          confirmTestId="ecs-taskdef-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">ファミリー名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="ecs-taskdef-family"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600">コンテナ定義(JSON 配列)</span>
          <textarea
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            data-testid="ecs-taskdef-json"
            rows={12}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            サポートするキー: name / image / memory / cpu / essential / command。
            その他のキーは無視されます。
          </span>
        </label>
      </div>
    </Modal>
  );
}
