import { useState } from "react";
import { Modal, ModalFooter } from "../../components/ui";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export interface CreateUserInput {
  username: string;
  email?: string;
  tempPassword?: string;
}

export function CreateUserModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (input: CreateUserInput) => Promise<void>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = username.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit({
        username: trimmed,
        email: email.trim() || undefined,
        tempPassword: tempPassword.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="ユーザーの作成"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="cu-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>ユーザー名</span>
          <input
            className={FIELD}
            data-testid="cu-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>メールアドレス(任意)</span>
          <input
            className={FIELD}
            data-testid="cu-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={LABEL}>
          <span className={LABEL_TEXT}>一時パスワード(任意)</span>
          <input
            className={FIELD}
            data-testid="cu-temp-password"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
