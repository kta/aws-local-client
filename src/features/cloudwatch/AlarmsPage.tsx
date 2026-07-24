import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { AlarmSummary, PutMetricAlarmRequest } from "../../api/cloudwatch";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateAlarmModal } from "./CreateAlarmModal";

export function AlarmsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<AlarmSummary[]>((profile) => api.cloudwatch.describeAlarms(profile));
  const alarms = data ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AlarmSummary | null>(null);

  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const error = fetchError && !unsupported ? fetchError : null;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createAlarm = async (req: PutMetricAlarmRequest) => {
    if (!active) return;
    try {
      await api.cloudwatch.putMetricAlarm(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedAlarm = selectedName ? alarms.find((a) => a.name === selectedName) ?? null : null;

  const columns: Column<AlarmSummary>[] = [
    { key: "name", header: "名前", className: "font-semibold text-[#0972d3]", render: (a) => a.name },
    { key: "state", header: "状態", render: (a) => <StatusBadge status={a.state} /> },
    { key: "metric", header: "メトリクス", render: (a) => a.metricName ?? "-" },
    { key: "namespace", header: "名前空間", render: (a) => a.namespace ?? "-" },
    {
      key: "condition",
      header: "条件",
      render: (a) =>
        a.threshold == null ? "-" : `${a.comparisonOperator ?? ""} ${a.threshold}`,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="アラーム"
          count={unsupported ? undefined : alarms.length}
          titleTestId="alarms-heading"
          countTestId="alarms-count"
        >
          {!unsupported && (
            <>
              <button
                onClick={() => selectedAlarm && setDeleting(selectedAlarm)}
                disabled={selected.size !== 1}
                data-testid="alarm-delete"
                className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
              >
                削除
              </button>
              <Button variant="primary" onClick={() => setCreating(true)} data-testid="alarm-create">
                アラームの作成
              </Button>
            </>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="cloudwatch-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは CloudWatch アラームをサポートしていません
            </div>
            <div className="mt-1 text-amber-800">対応エミュレータ: localstack、floci、ministack</div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={actionError ?? error} onRetry={reload} />

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={alarms}
              rowKey={(a) => a.name}
              loading={loading}
              emptyText={error ? undefined : "アラームがありません"}
              rowTestId="alarm-row"
              selection={{
                isSelected: (a) => selected.has(a.name),
                onToggle: (a) => toggle(a.name),
                ariaLabel: (a) => `${a.name} を選択`,
              }}
            />
          </Card>
        )}

        {creating && <CreateAlarmModal onSubmit={createAlarm} onClose={() => setCreating(false)} />}

        {deleting && (
          <ConfirmDangerModal
            title="アラームの削除"
            description={
              <>
                アラーム <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のため名前を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.cloudwatch.deleteAlarms(active, [deleting.name]);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="alarm-delete-input"
            confirmTestId="alarm-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
