import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { TaskDefinitionDetail, TaskDefinitionSummary } from "../../api/ecs";
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
  PageHeader,
} from "../../components/ui";
import { formatDate } from "../../lib/format";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { EcsUnsupported } from "./EcsUnsupported";
import { RegisterTaskDefModal } from "./RegisterTaskDefModal";

function TaskDefDetailModal({
  detail,
  onClose,
}: {
  detail: TaskDefinitionDetail;
  onClose: () => void;
}) {
  return (
    <Modal title={`${detail.family}:${detail.revision}`} onClose={onClose} maxWidth="2xl">
      <div data-testid="ecs-taskdef-detail" className="space-y-2 text-sm">
        <div className="text-[#5f6b7a]">ステータス: {detail.status || "-"}</div>
        {detail.registeredAt && (
          <div className="text-[#5f6b7a]">登録日時: {formatDate(detail.registeredAt)}</div>
        )}
        <table className="mt-2 w-full border-collapse text-xs" data-testid="ecs-taskdef-containers">
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:text-[#5f6b7a]">
              <th>コンテナ名</th>
              <th>イメージ</th>
              <th>メモリ</th>
              <th>必須</th>
              <th>コマンド</th>
            </tr>
          </thead>
          <tbody>
            {detail.containers.map((c) => (
              <tr
                key={c.name}
                data-testid={`ecs-container-row-${c.name}`}
                className="[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-2 [&>td]:py-1"
              >
                <td className="font-mono">{c.name}</td>
                <td className="font-mono">{c.image}</td>
                <td>{c.memory ?? "-"}</td>
                <td>{c.essential ? "はい" : "いいえ"}</td>
                <td className="font-mono">{c.command.join(" ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function TaskDefinitionsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<TaskDefinitionSummary[]>((profile) =>
    api.ecs.listTaskDefinitions(profile),
  );
  const taskDefs = data ?? [];

  const [actionError, setActionError] = useState<AppError | null>(null);
  const [registering, setRegistering] = useState(false);
  const [detail, setDetail] = useState<TaskDefinitionDetail | null>(null);
  const [deregistering, setDeregistering] = useState<TaskDefinitionSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const unsupported = fetchError && isUnsupportedOperation(fetchError) ? fetchError : null;
  const bannerError = actionError ?? (fetchError && !unsupported ? fetchError : null);

  const register = async (family: string, containerDefsJson: string) => {
    if (!active) return;
    try {
      const result = await api.ecs.registerTaskDefinition(active, family, containerDefsJson);
      setRegistering(false);
      setActionError(null);
      setNote(
        result.ignoredKeys.length > 0
          ? `${result.family}:${result.revision} を登録しました。次のキーは無視されました: ${result.ignoredKeys.join(", ")}`
          : `${result.family}:${result.revision} を登録しました。`,
      );
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const openDetail = async (arn: string) => {
    if (!active) return;
    try {
      setActionError(null);
      setDetail(await api.ecs.describeTaskDefinition(active, arn));
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const columns: Column<TaskDefinitionSummary>[] = [
    {
      key: "family",
      header: "ファミリー:リビジョン",
      render: (td) => (
        <button
          type="button"
          onClick={() => openDetail(td.arn)}
          data-testid={`ecs-taskdef-row-${td.family}:${td.revision}`}
          className="font-semibold text-[#0972d3] hover:underline"
        >
          {td.family}:{td.revision}
        </button>
      ),
    },
    { key: "revision", header: "リビジョン", render: (td) => String(td.revision) },
    {
      key: "actions",
      header: "",
      render: (td) => (
        <button
          type="button"
          onClick={() => setDeregistering(td)}
          data-testid={`ecs-taskdef-deregister-${td.family}:${td.revision}`}
          className="rounded border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-2 py-1 text-[12px] font-semibold text-[#d13212] hover:border-[#5f6b7a]"
        >
          登録解除
        </button>
      ),
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="タスク定義"
          count={unsupported ? undefined : taskDefs.length}
          titleTestId="ecs-taskdefs-heading"
          countTestId="ecs-taskdefs-count"
        >
          {!unsupported && (
            <Button
              variant="primary"
              onClick={() => setRegistering(true)}
              data-testid="ecs-taskdef-register"
            >
              新しいタスク定義の作成
            </Button>
          )}
        </PageHeader>

        {unsupported && <EcsUnsupported error={unsupported} />}

        <ErrorBanner error={bannerError} onRetry={reload} />

        {note && (
          <div
            data-testid="ecs-taskdef-note"
            className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
          >
            {note}
          </div>
        )}

        {!unsupported && (
          <Card className="overflow-x-auto">
            <DataTable
              variant="list"
              columns={columns}
              rows={taskDefs}
              rowKey={(td) => td.arn}
              loading={loading}
              emptyText={fetchError ? undefined : "タスク定義がありません"}
            />
          </Card>
        )}

        {registering && (
          <RegisterTaskDefModal onSubmit={register} onClose={() => setRegistering(false)} />
        )}

        {detail && <TaskDefDetailModal detail={detail} onClose={() => setDetail(null)} />}

        {deregistering && (
          <ConfirmDangerModal
            title="タスク定義の登録解除"
            description={
              <>
                タスク定義{" "}
                <b className="font-mono text-[#16191f]">
                  {deregistering.family}:{deregistering.revision}
                </b>{" "}
                を登録解除します。確認のためファミリー名を入力してください。
              </>
            }
            requiredText={deregistering.family}
            confirmLabel="登録解除"
            onConfirm={async () => {
              if (!active) return;
              try {
                await api.ecs.deregisterTaskDefinition(active, deregistering.arn);
                setDeregistering(null);
                await reload();
              } catch (e) {
                setDeregistering(null);
                setActionError(toAppError(e));
              }
            }}
            onClose={() => setDeregistering(null)}
            inputTestId="ecs-taskdef-deregister-input"
            confirmTestId="ecs-taskdef-deregister-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
