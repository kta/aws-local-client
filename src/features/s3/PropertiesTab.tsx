import { useEffect, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { BucketProperties, BucketTag } from "../../api/s3";
import type { AppError, ConnectionProfile } from "../../api/types";
import { Button, Card, input as inputCx } from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";

/**
 * Bucket "properties" tab: versioning, tags, CORS and bucket policy.
 * Unset configuration is shown as "未設定" rather than an error (R43).
 */
export function PropertiesTab({
  profile,
  bucket,
  onError,
}: {
  profile: ConnectionProfile;
  bucket: string;
  onError: (e: AppError | null) => void;
}) {
  const {
    data: props,
    error,
    reload,
  } = useProfileScopedFetch<BucketProperties>(
    (p) => api.s3.getBucketProperties(p, bucket),
    [bucket],
  );

  // Surface the properties-load error through the page-level banner.
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  if (error) return null;
  if (!props) return <div className="text-sm text-[#5f6b7a]">読み込み中...</div>;

  return (
    <div className="space-y-4">
      <VersioningSection
        profile={profile}
        bucket={bucket}
        status={props.versioning}
        onError={onError}
        onSaved={reload}
      />
      <TagsSection
        profile={profile}
        bucket={bucket}
        tags={props.tags}
        onError={onError}
        onSaved={reload}
      />
      <JsonSection
        title="CORS 設定"
        testidEditor="props-cors-editor"
        testidSave="props-cors-save"
        value={props.corsJson}
        placeholder='[{"allowedMethods":["GET"],"allowedOrigins":["*"]}]'
        onSave={(v) => api.s3.putBucketCors(profile, bucket, v)}
        onError={onError}
        onSaved={reload}
      />
      <JsonSection
        title="バケットポリシー"
        testidEditor="props-policy-editor"
        testidSave="props-policy-save"
        value={props.policyJson}
        placeholder='{"Version":"2012-10-17","Statement":[]}'
        onSave={(v) => api.s3.putBucketPolicy(profile, bucket, v)}
        onError={onError}
        onSaved={reload}
      />
    </div>
  );
}

function VersioningSection({
  profile,
  bucket,
  status,
  onError,
  onSaved,
}: {
  profile: ConnectionProfile;
  bucket: string;
  status: string | null;
  onError: (e: AppError | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = status === "Enabled";

  const toggle = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.s3.setVersioning(profile, bucket, !enabled);
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="バージョニング" overflowHidden>
      <div className="flex items-center justify-between p-4">
        <div className="text-sm">
          状態:{" "}
          <span data-testid="props-versioning-status" className="font-semibold">
            {status ?? "未設定"}
          </span>
        </div>
        <Button
          variant={enabled ? "secondary" : "primary"}
          onClick={toggle}
          disabled={saving}
          data-testid="props-versioning-toggle"
        >
          {enabled ? "停止" : "有効化"}
        </Button>
      </div>
    </Card>
  );
}

function TagsSection({
  profile,
  bucket,
  tags,
  onError,
  onSaved,
}: {
  profile: ConnectionProfile;
  bucket: string;
  tags: BucketTag[];
  onError: (e: AppError | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<BucketTag[]>(tags);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(tags);
  }, [tags]);

  const addRow = () => {
    if (!newKey.trim()) return;
    setRows((prev) => [...prev.filter((t) => t.key !== newKey), { key: newKey, value: newValue }]);
    setNewKey("");
    setNewValue("");
  };

  const removeRow = (key: string) => setRows((prev) => prev.filter((t) => t.key !== key));

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.s3.putBucketTagging(profile, bucket, rows);
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="タグ" overflowHidden>
      <div className="space-y-3 p-4">
        <table data-testid="props-tags-table" className="w-full border-collapse">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
              <th>キー</th>
              <th>値</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-center text-sm text-[#5f6b7a]">
                  タグがありません
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr
                key={t.key}
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-2 [&>td]:py-1"
              >
                <td className="text-sm">{t.key}</td>
                <td className="text-sm">{t.value}</td>
                <td className="text-right">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => removeRow(t.key)}
                    data-testid={`props-tag-remove-${t.key}`}
                  >
                    削除
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-end gap-2">
          <input
            className={inputCx}
            placeholder="キー"
            data-testid="props-tag-key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <input
            className={inputCx}
            placeholder="値"
            data-testid="props-tag-value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button onClick={addRow} data-testid="props-tag-add">
            追加
          </Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={save} disabled={saving} data-testid="props-tag-save">
            {saving ? "保存中..." : "タグを保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function JsonSection({
  title,
  testidEditor,
  testidSave,
  value,
  placeholder,
  onSave,
  onError,
  onSaved,
}: {
  title: string;
  testidEditor: string;
  testidSave: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string) => Promise<void>;
  onError: (e: AppError | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await onSave(text);
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={title} overflowHidden>
      <div className="space-y-3 p-4">
        {value == null && <div className="text-xs text-[#5f6b7a]">未設定</div>}
        <textarea
          className={`${inputCx} w-full font-mono text-xs`}
          rows={6}
          placeholder={placeholder}
          data-testid={testidEditor}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} disabled={saving} data-testid={testidSave}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
