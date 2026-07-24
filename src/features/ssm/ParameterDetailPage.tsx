import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ParameterHistoryEntry, ParameterValue } from "../../api/ssm";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Button, Card, ConnectionRequired } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useConnections } from "../../state/connections";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL_TEXT = "text-gray-600";

export function ParameterDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const name = rawName ?? "";
  const { active } = useConnections();

  const {
    data: detail,
    error,
    reload,
  } = useProfileScopedFetch<ParameterValue>(
    (profile) => api.ssm.getParameter(profile, name, true),
    [name],
  );

  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState<ParameterHistoryEntry[]>([]);
  const [historyUnsupported, setHistoryUnsupported] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const loadHistory = useCallback(
    async (profile: ConnectionProfile) => {
      setHistoryUnsupported(false);
      try {
        setHistory(await api.ssm.getParameterHistory(profile, name));
      } catch (e) {
        const err = toAppError(e);
        if (isUnsupportedOperation(err)) {
          setHistory([]);
          setHistoryUnsupported(true);
        } else {
          setActionError(err);
        }
      }
    },
    [name],
  );

  useEffect(() => {
    if (active) void loadHistory(active);
  }, [active, loadHistory]);

  const isSecure = detail?.type === "SecureString";

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/ssm/parameters" className="font-semibold text-[#0972d3] hover:underline">
            パラメータストア
          </Link>
          {" / "}
          {name}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="param-detail-heading">
            {name}
          </h1>
          {detail && (
            <span className="text-[12.5px] font-semibold text-[#5f6b7a]">{detail.type}</span>
          )}
        </div>

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        {detail && (
          <Card title="値" overflowHidden>
            <div className="space-y-2 p-4 text-[13px]">
              <div>
                <span className={LABEL_TEXT}>バージョン: </span>
                <span data-testid="param-version">{detail.version}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={LABEL_TEXT}>値: </span>
                <span
                  className="font-mono text-xs break-all"
                  data-testid="ssm-value"
                >
                  {isSecure && !revealed ? "●●●●●●●●" : detail.value}
                </span>
                {isSecure && (
                  <button
                    onClick={() => setRevealed((v) => !v)}
                    data-testid="ssm-value-toggle"
                    className="text-[12.5px] font-semibold text-[#0972d3] hover:underline"
                  >
                    {revealed ? "非表示" : "表示"}
                  </button>
                )}
              </div>
            </div>
          </Card>
        )}

        {detail && active && (
          <div className="mt-4">
            <UpdateValueCard
              profile={active}
              current={detail}
              onSaved={async () => {
                await reload();
                await loadHistory(active);
              }}
              onError={setActionError}
            />
          </div>
        )}

        <div className="mt-4">
          <Card title="バージョン履歴" overflowHidden>
            {historyUnsupported ? (
              <div
                data-testid="ssm-history-unsupported"
                className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <div className="font-semibold">
                  このエミュレータはパラメータのバージョン履歴 (GetParameterHistory)
                  をサポートしていません
                </div>
              </div>
            ) : (
              <table
                data-testid="ssm-history-table"
                className="w-full border-collapse [font-variant-numeric:tabular-nums]"
              >
                <thead>
                  <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                    <th>バージョン</th>
                    <th>値</th>
                    <th>更新日時</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                        履歴がありません。
                      </td>
                    </tr>
                  )}
                  {history.map((h) => (
                    <tr
                      key={h.version}
                      data-testid={`ssm-history-row-${h.version}`}
                      className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
                    >
                      <td className="font-mono text-xs">{h.version}</td>
                      <td className="max-w-[360px] truncate font-mono text-xs">
                        {h.type === "SecureString" ? "●●●●●●●●" : h.value}
                      </td>
                      <td className="text-xs text-[#5f6b7a]">{formatDate(h.lastModified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </ConnectionRequired>
  );
}

function UpdateValueCard({
  profile,
  current,
  onSaved,
  onError,
}: {
  profile: ConnectionProfile;
  current: ParameterValue;
  onSaved: () => Promise<void>;
  onError: (e: AppError | null) => void;
}) {
  const [value, setValue] = useState(current.value);
  const [saving, setSaving] = useState(false);

  // Reset the editor when a fresh detail (re)loads.
  useEffect(() => {
    setValue(current.value);
  }, [current]);

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.ssm.putParameter(profile, {
        name: current.name,
        value,
        type: current.type,
        overwrite: true,
      });
      await onSaved();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="値の更新" overflowHidden>
      <div className="space-y-3 p-4">
        <label className="block text-sm">
          <span className={LABEL_TEXT}>新しい値(上書きするとバージョンが増加します)</span>
          <textarea
            className={`${FIELD} font-mono text-xs`}
            data-testid="ssm-update-value"
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || value.length === 0}
            data-testid="ssm-update-save"
          >
            {saving ? "更新中..." : "更新"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
