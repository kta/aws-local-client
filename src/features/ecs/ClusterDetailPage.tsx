import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { ServiceSummary, TaskDefinitionSummary, TaskSummary } from "../../api/ecs";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateServiceModal } from "./CreateServiceModal";

type Tab = "services" | "tasks";

const UNSUPPORTED_NOTE =
  "px-4 py-3 text-sm text-amber-900 rounded border border-amber-300 bg-amber-50 m-1";

function tabClass(active: boolean): string {
  return `-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
    active ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
  }`;
}

function DesiredCountModal({
  service,
  onSubmit,
  onClose,
}: {
  service: ServiceSummary;
  onSubmit: (desired: number) => Promise<void>;
  onClose: () => void;
}) {
  const [desired, setDesired] = useState(service.desiredCount);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`希望タスク数の変更: ${service.name}`}
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={async () => {
            setBusy(true);
            try {
              await onSubmit(desired);
            } finally {
              setBusy(false);
            }
          }}
          confirmLabel="保存"
          confirmingLabel="保存中..."
          confirmTestId="ecs-service-desired-save"
          busy={busy}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">希望タスク数</span>
        <input
          type="number"
          min={0}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="ecs-service-desired"
          value={desired}
          onChange={(e) => setDesired(Number(e.target.value))}
        />
      </label>
    </Modal>
  );
}

function RunTaskModal({
  taskDefs,
  onSubmit,
  onClose,
}: {
  taskDefs: TaskDefinitionSummary[];
  onSubmit: (taskDef: string) => Promise<void>;
  onClose: () => void;
}) {
  const [taskDef, setTaskDef] = useState(taskDefs[0]?.arn ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="タスクの実行"
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={async () => {
            if (!taskDef) return;
            setBusy(true);
            try {
              await onSubmit(taskDef);
            } finally {
              setBusy(false);
            }
          }}
          confirmLabel="実行"
          confirmingLabel="実行中..."
          confirmDisabled={!taskDef}
          confirmTestId="ecs-task-run-confirm"
          busy={busy}
        />
      }
    >
      <label className="block text-sm">
        <span className="text-gray-600">タスク定義</span>
        <select
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
          data-testid="ecs-task-taskdef"
          value={taskDef}
          onChange={(e) => setTaskDef(e.target.value)}
        >
          {taskDefs.length === 0 && <option value="">タスク定義がありません</option>}
          {taskDefs.map((td) => (
            <option key={td.arn} value={td.arn}>
              {td.family}:{td.revision}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}

export function ClusterDetailPage() {
  const { name = "" } = useParams<{ name: string }>();
  const { active } = useConnections();
  const [tab, setTab] = useState<Tab>("services");
  const [actionError, setActionError] = useState<AppError | null>(null);

  const [creatingService, setCreatingService] = useState(false);
  const [editingService, setEditingService] = useState<ServiceSummary | null>(null);
  const [deletingService, setDeletingService] = useState<ServiceSummary | null>(null);
  const [runningTask, setRunningTask] = useState(false);

  const services = useProfileScopedFetch<ServiceSummary[]>(
    (profile) => api.ecs.listServices(profile, name),
    [name],
  );
  const tasks = useProfileScopedFetch<TaskSummary[]>(
    (profile) => api.ecs.listTasks(profile, name),
    [name],
  );
  const taskDefsFetch = useProfileScopedFetch<TaskDefinitionSummary[]>(
    (profile) => api.ecs.listTaskDefinitions(profile),
    [name],
  );
  const taskDefs = taskDefsFetch.data ?? [];

  const servicesUnsupported =
    services.error && isUnsupportedOperation(services.error) ? services.error : null;
  const tasksUnsupported =
    tasks.error && isUnsupportedOperation(tasks.error) ? tasks.error : null;

  const serviceColumns: Column<ServiceSummary>[] = [
    { key: "name", header: "名前", className: "font-semibold", render: (s) => s.name },
    { key: "status", header: "ステータス", render: (s) => s.status },
    { key: "taskDefinition", header: "タスク定義", render: (s) => s.taskDefinition },
    {
      key: "counts",
      header: "実行中 / 希望",
      render: (s) => `${s.runningCount} / ${s.desiredCount}`,
    },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingService(s)}
            data-testid={`ecs-service-edit-${s.name}`}
            className="rounded border border-[#d9dee3] px-2 py-1 text-[12px] font-semibold text-[#0972d3] hover:border-[#5f6b7a]"
          >
            希望数変更
          </button>
          <button
            type="button"
            onClick={() => setDeletingService(s)}
            data-testid={`ecs-service-delete-${s.name}`}
            className="rounded border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-2 py-1 text-[12px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
          >
            削除
          </button>
        </div>
      ),
    },
  ];

  const taskColumns: Column<TaskSummary>[] = [
    {
      key: "id",
      header: "タスク ID",
      className: "font-mono text-[12px]",
      render: (t) => <span data-testid={`ecs-task-row-${t.id}`}>{t.id}</span>,
    },
    { key: "taskDef", header: "タスク定義", render: (t) => t.taskDefinitionArn },
    { key: "lastStatus", header: "ステータス", render: (t) => t.lastStatus },
    { key: "desiredStatus", header: "希望ステータス", render: (t) => t.desiredStatus },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <button
          type="button"
          onClick={() => stopTask(t)}
          data-testid={`ecs-task-stop-${t.id}`}
          className="rounded border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-2 py-1 text-[12px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
        >
          停止
        </button>
      ),
    },
  ];

  const createService = async (svcName: string, taskDef: string, desired: number) => {
    if (!active) return;
    try {
      await api.ecs.createService(active, name, svcName, taskDef, desired);
      setCreatingService(false);
      setActionError(null);
      await services.reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const updateDesired = async (svcName: string, desired: number) => {
    if (!active) return;
    try {
      await api.ecs.updateService(active, name, svcName, desired);
      setEditingService(null);
      setActionError(null);
      await services.reload();
    } catch (e) {
      setEditingService(null);
      setActionError(toAppError(e));
    }
  };

  const runTask = async (taskDef: string) => {
    if (!active) return;
    try {
      await api.ecs.runTask(active, name, taskDef);
      setRunningTask(false);
      setActionError(null);
      await tasks.reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const stopTask = async (task: TaskSummary) => {
    if (!active) return;
    try {
      await api.ecs.stopTask(active, name, task.arn);
      setActionError(null);
      await tasks.reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link to="/ecs/clusters" className="font-semibold text-[#0972d3] hover:underline">
            クラスター
          </Link>
          {" / "}
          {name}
        </div>
        <h1 className="mb-4 text-[20px] font-bold" data-testid="ecs-cluster-detail-heading">
          {name}
        </h1>

        <ErrorBanner error={actionError} onRetry={() => setActionError(null)} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button
            onClick={() => setTab("services")}
            data-testid="ecs-tab-services"
            className={tabClass(tab === "services")}
          >
            サービス
          </button>
          <button
            onClick={() => setTab("tasks")}
            data-testid="ecs-tab-tasks"
            className={tabClass(tab === "tasks")}
          >
            タスク
          </button>
        </div>

        {tab === "services" && (
          <div>
            {servicesUnsupported ? (
              <div data-testid="ecs-services-unsupported" className={UNSUPPORTED_NOTE}>
                このエミュレータはサービス一覧 (ListServices) をサポートしていません。
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={() => setCreatingService(true)}
                    data-testid="ecs-service-create"
                  >
                    サービスの作成
                  </Button>
                </div>
                <Card className="overflow-x-auto">
                  <DataTable
                    variant="list"
                    columns={serviceColumns}
                    rows={services.data ?? []}
                    rowKey={(s) => s.name}
                    loading={services.loading}
                    emptyText={services.error ? undefined : "サービスがありません"}
                  />
                </Card>
              </>
            )}
          </div>
        )}

        {tab === "tasks" && (
          <div>
            {tasksUnsupported ? (
              <div data-testid="ecs-tasks-unsupported" className={UNSUPPORTED_NOTE}>
                このエミュレータはタスク一覧 (ListTasks) をサポートしていません。
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={() => setRunningTask(true)}
                    data-testid="ecs-task-run"
                  >
                    新しいタスクの実行
                  </Button>
                  <Button onClick={() => tasks.reload()} data-testid="ecs-task-refresh">
                    更新
                  </Button>
                </div>
                <Card className="overflow-x-auto">
                  <DataTable
                    variant="list"
                    columns={taskColumns}
                    rows={tasks.data ?? []}
                    rowKey={(t) => t.arn}
                    loading={tasks.loading}
                    emptyText={tasks.error ? undefined : "実行中のタスクがありません"}
                  />
                </Card>
              </>
            )}
          </div>
        )}

        {creatingService && (
          <CreateServiceModal
            taskDefs={taskDefs}
            onSubmit={createService}
            onClose={() => setCreatingService(false)}
          />
        )}

        {editingService && (
          <DesiredCountModal
            service={editingService}
            onSubmit={(d) => updateDesired(editingService.name, d)}
            onClose={() => setEditingService(null)}
          />
        )}

        {runningTask && (
          <RunTaskModal
            taskDefs={taskDefs}
            onSubmit={runTask}
            onClose={() => setRunningTask(false)}
          />
        )}

        {deletingService && (
          <ConfirmDangerModal
            title="サービスの削除"
            description={
              <>
                サービス <b className="font-mono text-[#16191f]">{deletingService.name}</b>{" "}
                を削除します。確認のためサービス名を入力してください。
              </>
            }
            requiredText={deletingService.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              try {
                await api.ecs.deleteService(active, name, deletingService.name);
                setDeletingService(null);
                await services.reload();
              } catch (e) {
                setDeletingService(null);
                setActionError(toAppError(e));
              }
            }}
            onClose={() => setDeletingService(null)}
            inputTestId="ecs-service-delete-input"
            confirmTestId="ecs-service-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
