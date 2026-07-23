import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import type { CreateFunctionRequest } from "../../api/lambda";
import { Modal, ModalFooter } from "../../components/ui";

// Test hook: E2E injects a fixed path so the native file dialog is bypassed.
declare global {
  interface Window {
    __E2E_UPLOAD_PATH?: string;
  }
}

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

// python / nodejs runtimes offered by the create form (spec §3.1 / R52).
const RUNTIMES = [
  "python3.12",
  "python3.11",
  "python3.10",
  "nodejs20.x",
  "nodejs18.x",
];

/** Last path segment of a filesystem path (POSIX or Windows separators). */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function CreateFunctionModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (req: CreateFunctionRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState(RUNTIMES[0]);
  const [handler, setHandler] = useState("index.handler");
  const [zipPath, setZipPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && handler.trim().length > 0 && zipPath.length > 0;

  const pickZip = async () => {
    let path = window.__E2E_UPLOAD_PATH;
    if (path === undefined) {
      const chosen = await open({
        multiple: false,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });
      if (typeof chosen !== "string") return; // cancelled
      path = chosen;
    }
    setZipPath(path);
  };

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmed,
        runtime,
        handler: handler.trim(),
        zipPath,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="関数の作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="fn-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>関数名</span>
          <input
            className={FIELD}
            data-testid="fn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>ランタイム</span>
          <select
            className={FIELD}
            data-testid="fn-runtime"
            value={runtime}
            onChange={(e) => setRuntime(e.target.value)}
          >
            {RUNTIMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className={LABEL}>
          <span className={LABEL_TEXT}>ハンドラ</span>
          <input
            className={FIELD}
            data-testid="fn-handler"
            value={handler}
            onChange={(e) => setHandler(e.target.value)}
          />
        </label>

        <div>
          <span className={LABEL_TEXT}>デプロイパッケージ(zip)</span>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={pickZip}
              data-testid="fn-zip"
              className="rounded-lg border border-[#d9dee3] px-[14px] py-[6px] text-[13px] font-semibold text-[#0972d3] hover:border-[#5f6b7a]"
            >
              zip を選択
            </button>
            <span className="truncate text-xs text-gray-500" data-testid="fn-zip-name">
              {zipPath ? baseName(zipPath) : "未選択"}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          実行ロールはローカルエミュレータ用のダミー ARN
          (arn:aws:iam::000000000000:role/nlsd-dummy)が自動設定されます。
        </p>
      </div>
    </Modal>
  );
}
