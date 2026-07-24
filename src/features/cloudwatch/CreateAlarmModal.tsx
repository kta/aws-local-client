import { useState } from "react";
import type { PutMetricAlarmRequest } from "../../api/cloudwatch";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

const COMPARISONS = [
  "GreaterThanThreshold",
  "GreaterThanOrEqualToThreshold",
  "LessThanThreshold",
  "LessThanOrEqualToThreshold",
];
const STATS = ["Average", "Sum", "Maximum", "Minimum", "SampleCount"];

export function CreateAlarmModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: PutMetricAlarmRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("");
  const [metricName, setMetricName] = useState("");
  const [stat, setStat] = useState("Average");
  const [periodSec, setPeriodSec] = useState(60);
  const [threshold, setThreshold] = useState(0);
  const [comparison, setComparison] = useState("GreaterThanThreshold");
  const [submitting, setSubmitting] = useState(false);

  const valid =
    name.trim().length > 0 && namespace.trim().length > 0 && metricName.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        namespace: namespace.trim(),
        metricName: metricName.trim(),
        stat,
        periodSec,
        threshold,
        comparison,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="アラームの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="alarm-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>アラーム名</span>
          <input
            className={FIELD}
            data-testid="alarm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>名前空間</span>
            <input
              className={FIELD}
              data-testid="alarm-namespace"
              value={namespace}
              placeholder="AWS/EC2"
              onChange={(e) => setNamespace(e.target.value)}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>メトリクス名</span>
            <input
              className={FIELD}
              data-testid="alarm-metric"
              value={metricName}
              onChange={(e) => setMetricName(e.target.value)}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>統計</span>
            <select
              className={FIELD}
              data-testid="alarm-stat"
              value={stat}
              onChange={(e) => setStat(e.target.value)}
            >
              {STATS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>期間(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="alarm-period"
              value={periodSec}
              onChange={(e) => setPeriodSec(Number(e.target.value))}
            />
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>比較演算子</span>
            <select
              className={FIELD}
              data-testid="alarm-comparison"
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            >
              {COMPARISONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>しきい値</span>
            <input
              type="number"
              className={FIELD}
              data-testid="alarm-threshold"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
