import { useState } from "react";
import type { PutRuleRequest } from "../../api/eventbridge";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateRuleModal({
  bus,
  onSubmit,
  onClose,
}: {
  bus: string;
  onSubmit: (req: PutRuleRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"pattern" | "schedule">("pattern");
  const [eventPattern, setEventPattern] = useState('{"source":["nlsd.app"]}');
  const [scheduleExpression, setScheduleExpression] = useState("rate(5 minutes)");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid =
    trimmed.length > 0 &&
    (mode === "pattern" ? eventPattern.trim().length > 0 : scheduleExpression.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmed,
        bus,
        eventPattern: mode === "pattern" ? eventPattern.trim() : undefined,
        scheduleExpression: mode === "schedule" ? scheduleExpression.trim() : undefined,
        description: description.trim() || undefined,
        enabled,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ルールの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="rule-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>ルール名</span>
          <input
            className={FIELD}
            data-testid="rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="text-sm">
          <span className={LABEL_TEXT}>種別</span>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                data-testid="rule-mode-pattern"
                checked={mode === "pattern"}
                onChange={() => setMode("pattern")}
              />
              イベントパターン
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                data-testid="rule-mode-schedule"
                checked={mode === "schedule"}
                onChange={() => setMode("schedule")}
              />
              スケジュール式
            </label>
          </div>
        </div>

        {mode === "pattern" ? (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>イベントパターン(JSON)</span>
            <textarea
              className={`${FIELD} font-mono text-xs`}
              data-testid="rule-pattern"
              rows={4}
              value={eventPattern}
              onChange={(e) => setEventPattern(e.target.value)}
            />
          </label>
        ) : (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>スケジュール式</span>
            <input
              className={FIELD}
              data-testid="rule-schedule"
              value={scheduleExpression}
              onChange={(e) => setScheduleExpression(e.target.value)}
              placeholder="rate(5 minutes) または cron(0 12 * * ? *)"
            />
          </label>
        )}

        <label className={LABEL}>
          <span className={LABEL_TEXT}>説明(任意)</span>
          <input
            className={FIELD}
            data-testid="rule-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="rule-enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className={LABEL_TEXT}>作成時に有効化する</span>
        </label>
      </div>
    </Modal>
  );
}
