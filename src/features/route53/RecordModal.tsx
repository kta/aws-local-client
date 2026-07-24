import { useState } from "react";
import type { RecordSet } from "../../api/route53";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;

/**
 * Create or edit (UPSERT) a record set. In edit mode the record name and type
 * identify the record set, so they are locked; only TTL and values change.
 */
export function RecordModal({
  zoneName,
  initial,
  onSubmit,
  onClose,
}: {
  zoneName: string;
  initial?: RecordSet;
  onSubmit: (record: RecordSet) => Promise<void>;
  onClose: () => void;
}) {
  const editing = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [recordType, setRecordType] = useState<string>(initial?.recordType ?? "A");
  const [ttl, setTtl] = useState(initial?.ttl ?? 300);
  const [values, setValues] = useState((initial?.values ?? []).join("\n"));
  const [submitting, setSubmitting] = useState(false);

  const valueLines = values
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && valueLines.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        recordType,
        ttl: Number(ttl),
        values: valueLines,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={editing ? "レコードの編集" : "レコードの作成"}
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={editing ? "保存" : "作成"}
          confirmingLabel={editing ? "保存中..." : "作成中..."}
          confirmDisabled={!valid}
          confirmTestId="record-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>レコード名</span>
          <input
            className={FIELD}
            data-testid="record-name"
            value={name}
            disabled={editing}
            onChange={(e) => setName(e.target.value)}
            placeholder={`www.${zoneName}`}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>タイプ</span>
            <select
              className={FIELD}
              data-testid="record-type"
              value={recordType}
              disabled={editing}
              onChange={(e) => setRecordType(e.target.value)}
            >
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>TTL(秒)</span>
            <input
              type="number"
              className={FIELD}
              data-testid="record-ttl"
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
            />
          </label>
        </div>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>値(1行に1つ)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="record-values"
            rows={4}
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder={"1.2.3.4\n5.6.7.8"}
          />
        </label>
      </div>
    </Modal>
  );
}
