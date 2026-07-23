import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type {
  SecretDetail,
  SecretValue,
  SecretVersion,
} from "../../api/secretsmanager";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConnectionRequired, Modal, ModalFooter } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function SecretDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { active } = useConnections();
  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<SecretDetail>(
    (profile) => api.secretsManager.describe(profile, name ?? ""),
    [name],
  );

  const [actionError, setActionError] = useState<AppError | null>(null);
  // Bumped after a PutSecretValue so the versions table refetches even though
  // the route (and thus the page) does not remount.
  const [versionsNonce, setVersionsNonce] = useState(0);

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link
            to="/secrets-manager/secrets"
            className="font-semibold text-[#0972d3] hover:underline"
          >
            シークレット
          </Link>
          {" / "}
          {name}
        </div>
        <h1 className="mb-4 text-[20px] font-bold">{name}</h1>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        {detail && active && (
          <div className="space-y-4">
            <div className="text-[12px] text-[#5f6b7a]">
              ARN: <span className="font-mono">{detail.arn}</span>
              {detail.description && <> / 説明: {detail.description}</>}
              {detail.createdDate && <> / 作成: {formatDate(detail.createdDate)}</>}
            </div>

            <ValueSection
              profile={active}
              id={name ?? ""}
              onError={setActionError}
              onValueChanged={() => setVersionsNonce((n) => n + 1)}
            />
            <VersionsSection
              profile={active}
              id={name ?? ""}
              reloadKey={versionsNonce}
              onError={setActionError}
            />
            <TagsSection
              profile={active}
              id={name ?? ""}
              detail={detail}
              onChanged={reload}
              onError={setActionError}
            />
          </div>
        )}
      </div>
    </ConnectionRequired>
  );
}

function ValueSection({
  profile,
  id,
  onError,
  onValueChanged,
}: {
  profile: ConnectionProfile;
  id: string;
  onError: (e: AppError | null) => void;
  onValueChanged: () => void;
}) {
  const [value, setValue] = useState<SecretValue | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [putting, setPutting] = useState(false);

  const load = async () => {
    onError(null);
    try {
      setValue(await api.secretsManager.getValue(profile, id));
    } catch (e) {
      onError(toAppError(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, id]);

  const secretString = value?.secretString ?? "";

  return (
    <Card title="シークレットの値" overflowHidden>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <pre
            data-testid="secret-value"
            className="flex-1 overflow-x-auto rounded bg-[#f5f6f7] px-3 py-2 font-mono text-xs text-[#16191f]"
          >
            {revealed ? secretString : "●●●●●●●●"}
          </pre>
          <Button
            onClick={() => setRevealed((r) => !r)}
            data-testid="secret-value-toggle"
          >
            {revealed ? "非表示" : "表示"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setPutting(true)} data-testid="secret-put">
            新しいバージョンを保存
          </Button>
        </div>
      </div>

      {putting && (
        <PutValueModal
          initial={secretString}
          onClose={() => setPutting(false)}
          onSubmit={async (next) => {
            onError(null);
            try {
              await api.secretsManager.putValue(profile, id, next);
              setPutting(false);
              await load();
              onValueChanged();
            } catch (e) {
              onError(toAppError(e));
            }
          }}
        />
      )}
    </Card>
  );
}

function PutValueModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit: (secretString: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (text.length === 0) return;
    setBusy(true);
    try {
      await onSubmit(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新しいバージョンを保存"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="保存"
          confirmingLabel="保存中..."
          confirmDisabled={text.length === 0}
          confirmTestId="sv-save"
          busy={busy}
        />
      }
    >
      <label className={LABEL}>
        <span className={LABEL_TEXT}>シークレットの値</span>
        <textarea
          className={`${FIELD} font-mono text-xs`}
          data-testid="sv-value"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
    </Modal>
  );
}

function VersionsSection({
  profile,
  id,
  reloadKey,
  onError,
}: {
  profile: ConnectionProfile;
  id: string;
  reloadKey: number;
  onError: (e: AppError | null) => void;
}) {
  const [versions, setVersions] = useState<SecretVersion[]>([]);

  useEffect(() => {
    onError(null);
    api.secretsManager
      .listVersions(profile, id)
      .then(setVersions)
      .catch((e) => onError(toAppError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, id, reloadKey]);

  return (
    <Card title="バージョン" overflowHidden>
      <table
        data-testid="versions-table"
        className="w-full border-collapse [font-variant-numeric:tabular-nums]"
      >
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
            <th>バージョン ID</th>
            <th>ステージ</th>
            <th>作成日時</th>
          </tr>
        </thead>
        <tbody>
          {versions.length === 0 && (
            <tr>
              <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                バージョンがありません。
              </td>
            </tr>
          )}
          {versions.map((v) => (
            <tr
              key={v.versionId}
              data-testid={`version-row-${v.versionId}`}
              className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
            >
              <td className="font-mono text-xs">{v.versionId}</td>
              <td className="font-mono text-xs">{v.stages.join(", ")}</td>
              <td className="text-xs text-[#5f6b7a]">{formatDate(v.createdDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TagsSection({
  profile,
  id,
  detail,
  onChanged,
  onError,
}: {
  profile: ConnectionProfile;
  id: string;
  detail: SecretDetail;
  onChanged: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const addTag = async () => {
    const key = newKey.trim();
    if (!key) return;
    setSaving(true);
    onError(null);
    try {
      await api.secretsManager.tag(profile, id, key, newValue);
      setAdding(false);
      setNewKey("");
      setNewValue("");
      await onChanged();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  const removeTag = async (key: string) => {
    onError(null);
    try {
      await api.secretsManager.untag(profile, id, key);
      await onChanged();
    } catch (e) {
      onError(toAppError(e));
    }
  };

  return (
    <Card title="タグ" overflowHidden>
      <div className="space-y-3 p-4">
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)} data-testid="tag-add" disabled={adding}>
            タグを追加
          </Button>
        </div>

        {adding && (
          <div className="flex flex-wrap items-end gap-2">
            <label className={LABEL}>
              <span className={LABEL_TEXT}>キー</span>
              <input
                className={FIELD}
                data-testid="tag-key-input"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </label>
            <label className={LABEL}>
              <span className={LABEL_TEXT}>値</span>
              <input
                className={FIELD}
                data-testid="tag-value-input"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </label>
            <Button variant="primary" onClick={addTag} disabled={saving} data-testid="tag-save">
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        )}

        <table
          data-testid="tags-table"
          className="w-full border-collapse [font-variant-numeric:tabular-nums]"
        >
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>キー</th>
              <th>値</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {detail.tags.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                  タグがありません。
                </td>
              </tr>
            )}
            {detail.tags.map((t) => (
              <tr
                key={t.key}
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
              >
                <td className="font-mono text-xs">{t.key}</td>
                <td className="font-mono text-xs">{t.value}</td>
                <td>
                  <button
                    onClick={() => removeTag(t.key)}
                    data-testid={`tag-remove-${t.key}`}
                    className="text-[13px] font-semibold text-[#d13212] hover:underline"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
