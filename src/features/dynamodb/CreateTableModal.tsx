import { useState } from "react";
import type { CreateTableRequest, GsiSpec, KeyAttr } from "../../api/types";
import { Modal, ModalFooter } from "../../components/ui";

const ATTR_TYPES = ["S", "N", "B"] as const;

function KeyAttrInputs({
  label,
  value,
  onChange,
  optional,
  testId,
  typeTestId,
}: {
  label: string;
  value: KeyAttr | null;
  onChange: (v: KeyAttr | null) => void;
  optional?: boolean;
  testId?: string;
  typeTestId?: string;
}) {
  return (
    <div className="flex items-end gap-2">
      <label className="flex-1 text-sm">
        <span className="text-gray-600">{label}</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid={testId}
          value={value?.name ?? ""}
          placeholder={optional ? "(なし)" : ""}
          onChange={(e) => {
            const name = e.target.value;
            if (!name && optional) onChange(null);
            else onChange({ name, attrType: value?.attrType ?? "S" });
          }}
        />
      </label>
      <select
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        data-testid={typeTestId}
        value={value?.attrType ?? "S"}
        disabled={!value}
        onChange={(e) => value && onChange({ ...value, attrType: e.target.value as KeyAttr["attrType"] })}
      >
        {ATTR_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    </div>
  );
}

export function CreateTableModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateTableRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [tableName, setTableName] = useState("");
  const [pk, setPk] = useState<KeyAttr | null>({ name: "", attrType: "S" });
  const [sk, setSk] = useState<KeyAttr | null>(null);
  const [gsis, setGsis] = useState<GsiSpec[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const valid = tableName.trim() && pk?.name.trim();

  const submit = async () => {
    if (!valid || !pk) return;
    setSubmitting(true);
    try {
      await onSubmit({ tableName: tableName.trim(), pk, sk, gsis: gsis.filter((g) => g.name && g.pk.name) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="テーブルの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="ct-submit"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">テーブル名</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="ct-name"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
          />
        </label>
        <KeyAttrInputs
          label="パーティションキー"
          value={pk}
          onChange={setPk}
          testId="ct-pk-name"
          typeTestId="ct-pk-type"
        />
        <KeyAttrInputs
          label="ソートキー(任意)"
          value={sk}
          onChange={setSk}
          optional
          testId="ct-sk-name"
          typeTestId="ct-sk-type"
        />

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">GSI</span>
            <button
              className="text-sm text-blue-600 hover:underline"
              data-testid="ct-add-gsi"
              onClick={() => setGsis([...gsis, { name: "", pk: { name: "", attrType: "S" }, sk: null }])}
            >
              + GSI を追加
            </button>
          </div>
          {gsis.map((g, i) => (
            <div key={i} className="mb-2 space-y-2 rounded border border-gray-200 p-2">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  placeholder="インデックス名"
                  data-testid={`ct-gsi-name-${i}`}
                  value={g.name}
                  onChange={(e) => setGsis(gsis.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <button
                  className="text-sm text-red-600 hover:underline"
                  onClick={() => setGsis(gsis.filter((_, j) => j !== i))}
                >
                  削除
                </button>
              </div>
              <KeyAttrInputs
                label="GSI パーティションキー"
                value={g.pk}
                onChange={(v) => v && setGsis(gsis.map((x, j) => (j === i ? { ...x, pk: v } : x)))}
                testId={`ct-gsi-pk-name-${i}`}
                typeTestId={`ct-gsi-pk-type-${i}`}
              />
              <KeyAttrInputs
                label="GSI ソートキー(任意)"
                value={g.sk ?? null}
                onChange={(v) => setGsis(gsis.map((x, j) => (j === i ? { ...x, sk: v } : x)))}
                optional
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
