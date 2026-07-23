import { useCallback, useEffect, useState } from "react";
import { api, toAppError } from "../../api/client";
import type { EventBusSummary, RuleSummary, TargetSummary } from "../../api/eventbridge";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  ConfirmDangerModal,
  ConnectionRequired,
  PageHeader,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateRuleModal } from "./CreateRuleModal";
import { PutEventsModal, type PutEventsInput } from "./PutEventsModal";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

export function RulesPage() {
  const { active } = useConnections();

  // Buses drive the selector; the rules list is scoped to the selected bus.
  const { data: busData, error: busError } = useProfileScopedFetch<EventBusSummary[]>((profile) =>
    api.eventbridge.listBuses(profile),
  );
  const buses = busData ?? [];
  const [bus, setBus] = useState("default");

  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<AppError | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [putting, setPutting] = useState(false);
  const [deleting, setDeleting] = useState<RuleSummary | null>(null);
  const [putResult, setPutResult] = useState<{ failedCount: number; eventIds: string[] } | null>(
    null,
  );

  const loadRules = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setFetchError(null);
    try {
      setRules(await api.eventbridge.listRules(active, bus));
    } catch (e) {
      setRules([]);
      setFetchError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [active, bus]);

  useEffect(() => {
    void loadRules();
    // Changing the bus drops the previously-selected rule.
    setSelectedRule(null);
  }, [loadRules]);

  const unsupported =
    (fetchError && isUnsupportedOperation(fetchError) ? fetchError : null) ??
    (busError && isUnsupportedOperation(busError) ? busError : null);

  const toggleRule = async (rule: RuleSummary) => {
    if (!active) return;
    setActionError(null);
    try {
      if (rule.state === "ENABLED") {
        await api.eventbridge.disableRule(active, rule.name, bus);
      } else {
        await api.eventbridge.enableRule(active, rule.name, bus);
      }
      await loadRules();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const createRule = async (req: Parameters<typeof api.eventbridge.putRule>[1]) => {
    if (!active) return;
    try {
      await api.eventbridge.putRule(active, req);
      setCreating(false);
      setActionError(null);
      await loadRules();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const putEvents = async (input: PutEventsInput) => {
    if (!active) return;
    try {
      const res = await api.eventbridge.putEvents(
        active,
        bus,
        input.source,
        input.detailType,
        input.detail,
      );
      setPutResult(res);
      setPutting(false);
      setActionError(null);
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title="ルール" titleTestId="rules-heading">
          <Button onClick={() => setPutting(true)} data-testid="rules-put-events">
            イベントを送信
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="rules-create">
            ルールの作成
          </Button>
        </PageHeader>

        {unsupported && (
          <div
            data-testid="eventbridge-unsupported"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは EventBridge API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? (unsupported ? null : fetchError)} onRetry={loadRules} />

        <div className="mb-3 flex items-center gap-2">
          <label className="text-sm text-gray-600">イベントバス</label>
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            data-testid="rules-bus-select"
            value={bus}
            onChange={(e) => setBus(e.target.value)}
          >
            {/* The default bus is always selectable even before the list loads. */}
            {!buses.some((b) => b.name === "default") && <option value="default">default</option>}
            {buses.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {putResult && (
          <div
            data-testid="put-events-result"
            className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900"
          >
            イベントを送信しました(失敗 {putResult.failedCount} 件 / イベントID{" "}
            {putResult.eventIds.join(", ") || "-"})
          </div>
        )}

        <Card title="ルール" overflowHidden>
          <table
            data-testid="rules-table"
            className="w-full border-collapse [font-variant-numeric:tabular-nums]"
          >
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                <th>名前</th>
                <th>状態</th>
                <th>パターン / スケジュール</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                    読み込み中...
                  </td>
                </tr>
              )}
              {!loading && rules.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-[#5f6b7a]">
                    このバスにはルールがありません
                  </td>
                </tr>
              )}
              {!loading &&
                rules.map((r) => (
                  <tr
                    key={r.name}
                    data-testid={`rule-row-${r.name}`}
                    onClick={() =>
                      setSelectedRule((cur) => (cur === r.name ? null : r.name))
                    }
                    className="cursor-pointer [&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px] hover:[&>td]:bg-[color-mix(in_srgb,#0972d3_5%,#fff)]"
                  >
                    <td className="font-semibold text-[#0972d3]">{r.name}</td>
                    <td>
                      <span
                        data-testid={`rule-state-${r.name}`}
                        className={
                          r.state === "ENABLED"
                            ? "text-[13px] font-semibold text-emerald-700"
                            : "text-[13px] font-semibold text-[#5f6b7a]"
                        }
                      >
                        {r.state === "ENABLED" ? "有効" : "無効"}
                      </span>
                    </td>
                    <td className="max-w-[320px] truncate font-mono text-xs text-[#5f6b7a]">
                      {r.eventPattern ?? r.scheduleExpression ?? "-"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-3">
                        <button
                          onClick={() => toggleRule(r)}
                          data-testid={`rule-toggle-${r.name}`}
                          className="text-[13px] font-semibold text-[#0972d3] hover:underline"
                        >
                          {r.state === "ENABLED" ? "無効化" : "有効化"}
                        </button>
                        <button
                          onClick={() => setDeleting(r)}
                          data-testid={`rule-delete-${r.name}`}
                          className="text-[13px] font-semibold text-[#d13212] hover:underline"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>

        {selectedRule && active && (
          <TargetsPanel
            profile={active}
            bus={bus}
            rule={selectedRule}
            onError={setActionError}
          />
        )}

        {creating && (
          <CreateRuleModal bus={bus} onSubmit={createRule} onClose={() => setCreating(false)} />
        )}

        {putting && (
          <PutEventsModal bus={bus} onSubmit={putEvents} onClose={() => setPutting(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="ルールの削除"
            description={
              <>
                ルール <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.eventbridge.deleteRule(active, deleting.name, bus);
              if (selectedRule === deleting.name) setSelectedRule(null);
              setDeleting(null);
              await loadRules();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="rule-delete-input"
            confirmTestId="rule-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}

/** Target management for a single rule (add an SQS ARN, list, remove). */
function TargetsPanel({
  profile,
  bus,
  rule,
  onError,
}: {
  profile: ConnectionProfile;
  bus: string;
  rule: string;
  onError: (e: AppError | null) => void;
}) {
  const [targets, setTargets] = useState<TargetSummary[]>([]);
  const [arn, setArn] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      setTargets(await api.eventbridge.listTargets(profile, rule, bus));
    } catch (e) {
      onError(toAppError(e));
    }
    // onError is stable enough for this panel; keep deps minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, rule, bus]);

  useEffect(() => {
    void load();
  }, [load]);

  const addTarget = async () => {
    const value = arn.trim();
    if (!value) return;
    setSaving(true);
    onError(null);
    try {
      // Target ids only need to be unique within the rule; derive a stable one.
      const id = `t-${Date.now()}`;
      await api.eventbridge.putTarget(profile, rule, bus, id, value);
      setArn("");
      await load();
    } catch (e) {
      onError(toAppError(e));
    } finally {
      setSaving(false);
    }
  };

  const removeTarget = async (id: string) => {
    onError(null);
    try {
      await api.eventbridge.removeTarget(profile, rule, bus, id);
      await load();
    } catch (e) {
      onError(toAppError(e));
    }
  };

  return (
    <div className="mt-4">
      <Card title={`ターゲット(${rule})`} overflowHidden>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className={`${LABEL} flex-1`}>
              <span className={LABEL_TEXT}>ターゲット ARN(例: SQS キュー)</span>
              <input
                className={FIELD}
                data-testid="target-arn"
                value={arn}
                onChange={(e) => setArn(e.target.value)}
                placeholder="arn:aws:sqs:...:queue-name"
              />
            </label>
            <Button
              variant="primary"
              onClick={addTarget}
              disabled={saving || arn.trim().length === 0}
              data-testid="target-add"
            >
              {saving ? "追加中..." : "ターゲットを追加"}
            </Button>
          </div>

          <table
            data-testid="targets-table"
            className="w-full border-collapse [font-variant-numeric:tabular-nums]"
          >
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]">
                <th>ID</th>
                <th>ARN</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                    ターゲットがありません
                  </td>
                </tr>
              )}
              {targets.map((t) => (
                <tr
                  key={t.id}
                  data-testid={`target-row-${t.id}`}
                  className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]"
                >
                  <td className="font-mono text-xs">{t.id}</td>
                  <td className="font-mono text-xs">{t.arn}</td>
                  <td>
                    <button
                      onClick={() => removeTarget(t.id)}
                      data-testid={`target-remove-${t.id}`}
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
    </div>
  );
}
