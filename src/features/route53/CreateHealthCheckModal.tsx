import { useState } from "react";
import type { CreateHealthCheckRequest } from "../../api/route53";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function CreateHealthCheckModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateHealthCheckRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [port, setPort] = useState(80);
  const [checkType, setCheckType] = useState<"HTTP" | "TCP">("HTTP");
  const [resourcePath, setResourcePath] = useState("/");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = target.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        target: trimmed,
        port: Number(port),
        checkType,
        resourcePath: checkType === "HTTP" ? resourcePath.trim() || undefined : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ヘルスチェックの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="hc-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>IP アドレス / ドメイン名</span>
          <input
            className={FIELD}
            data-testid="hc-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="127.0.0.1 または example.com"
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>タイプ</span>
            <select
              className={FIELD}
              data-testid="hc-type"
              value={checkType}
              onChange={(e) => setCheckType(e.target.value as "HTTP" | "TCP")}
            >
              <option value="HTTP">HTTP</option>
              <option value="TCP">TCP</option>
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>ポート</span>
            <input
              type="number"
              className={FIELD}
              data-testid="hc-port"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
        </div>

        {checkType === "HTTP" && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>パス</span>
            <input
              className={FIELD}
              data-testid="hc-path"
              value={resourcePath}
              onChange={(e) => setResourcePath(e.target.value)}
              placeholder="/health"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
