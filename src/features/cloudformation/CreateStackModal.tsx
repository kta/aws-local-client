import { useState } from "react";
import type { CfnParameter } from "../../api/cloudformation";
import { Button, Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

const DEFAULT_TEMPLATE = `{
  "Resources": {
    "MyTopic": {
      "Type": "AWS::SNS::Topic",
      "Properties": { "TopicName": "my-topic" }
    }
  }
}`;

interface ParamRow {
  key: string;
  value: string;
}

export function CreateStackModal({
  mode = "create",
  initialName = "",
  initialTemplate,
  initialParameters,
  onSubmit,
  onClose,
}: {
  mode?: "create" | "update";
  initialName?: string;
  initialTemplate?: string;
  initialParameters?: CfnParameter[];
  onSubmit: (name: string, templateBody: string, parameters: CfnParameter[]) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [template, setTemplate] = useState(initialTemplate ?? DEFAULT_TEMPLATE);
  const [params, setParams] = useState<ParamRow[]>(
    initialParameters && initialParameters.length > 0
      ? initialParameters.map((p) => ({ key: p.key, value: p.value }))
      : [],
  );
  const [submitting, setSubmitting] = useState(false);

  const isUpdate = mode === "update";
  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && template.trim().length > 0;

  const setParamAt = (i: number, patch: Partial<ParamRow>) => {
    setParams((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };
  const addParam = () => setParams((prev) => [...prev, { key: "", value: "" }]);
  const removeParam = (i: number) => setParams((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const parameters = params
        .map((p) => ({ key: p.key.trim(), value: p.value }))
        .filter((p) => p.key.length > 0);
      await onSubmit(trimmedName, template, parameters);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isUpdate ? "スタックの更新" : "スタックの作成"}
      onClose={onClose}
      maxWidth="2xl"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={isUpdate ? "更新" : "作成"}
          confirmingLabel={isUpdate ? "更新中..." : "作成中..."}
          confirmDisabled={!valid}
          confirmTestId="cfn-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>スタック名</span>
          <input
            className={FIELD}
            data-testid="cfn-name"
            value={name}
            disabled={isUpdate}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>テンプレート(JSON / YAML)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="cfn-template"
            rows={12}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={LABEL_TEXT}>パラメータ</span>
            <Button onClick={addParam} data-testid="cfn-param-add">
              パラメータを追加
            </Button>
          </div>
          {params.length === 0 && (
            <div className="text-xs text-gray-500">パラメータはありません。</div>
          )}
          <div className="space-y-2">
            {params.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={`${FIELD} mt-0`}
                  data-testid={`cfn-param-key-${i}`}
                  placeholder="キー"
                  value={p.key}
                  onChange={(e) => setParamAt(i, { key: e.target.value })}
                />
                <input
                  className={`${FIELD} mt-0`}
                  data-testid={`cfn-param-value-${i}`}
                  placeholder="値"
                  value={p.value}
                  onChange={(e) => setParamAt(i, { value: e.target.value })}
                />
                <button
                  onClick={() => removeParam(i)}
                  data-testid={`cfn-param-remove-${i}`}
                  className="whitespace-nowrap text-[13px] font-semibold text-[#d13212] hover:underline"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
