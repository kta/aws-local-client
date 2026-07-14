import { useState } from "react";
import { api, toAppError } from "../../api/client";
import type { DbParameter, DbParameterGroup } from "../../api/rds";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  Modal,
  ModalFooter,
  PageHeader,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

function CreateParameterGroupModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, family: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [family, setFamily] = useState("mysql8.0");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = name.trim() && family.trim() && description.trim();

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), family.trim(), description.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="パラメータグループを作成"
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId="pg-save"
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-gray-600">名前</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="pg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">ファミリー</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="pg-family"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">説明</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            data-testid="pg-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

export function ParameterGroupsPage() {
  const { active } = useConnections();
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useProfileScopedFetch<DbParameterGroup[]>((profile) =>
    api.rds.listParameterGroups(profile),
  );
  const groups = data ?? [];
  const [opError, setOpError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useState<DbParameter[]>([]);
  const [marker, setMarker] = useState<string | null>(null);
  const [paramsLoading, setParamsLoading] = useState(false);

  // R50: unsupported describe takes over with parameter-groups-unsupported.
  const rawError = opError ?? loadError;
  const unsupported = rawError && isUnsupportedOperation(rawError) ? rawError : null;
  const error = rawError && !unsupported ? rawError : null;

  const retry = async () => {
    setOpError(null);
    await reload();
  };

  const loadParameters = async (groupName: string, nextMarker?: string) => {
    if (!active) return;
    setParamsLoading(true);
    setOpError(null);
    try {
      const res = await api.rds.listParameters(active, groupName, nextMarker);
      setParams((prev) => (nextMarker ? [...prev, ...res.parameters] : res.parameters));
      setMarker(res.marker);
    } catch (e) {
      setOpError(toAppError(e));
    } finally {
      setParamsLoading(false);
    }
  };

  const selectGroup = async (groupName: string) => {
    setSelected(groupName);
    setParams([]);
    setMarker(null);
    await loadParameters(groupName);
  };

  const createGroup = async (name: string, family: string, description: string) => {
    if (!active) return;
    setOpError(null);
    try {
      await api.rds.createParameterGroup(active, name, family, description);
      setCreating(false);
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const deleteGroup = async (group: DbParameterGroup) => {
    if (!active) return;
    if (!window.confirm(`パラメータグループ「${group.name}」を削除しますか?`)) return;
    setOpError(null);
    try {
      await api.rds.deleteParameterGroup(active, group.name);
      if (selected === group.name) {
        setSelected(null);
        setParams([]);
        setMarker(null);
      }
      await reload();
    } catch (e) {
      setOpError(toAppError(e));
    }
  };

  const groupColumns: Column<DbParameterGroup>[] = [
    {
      key: "name",
      header: "名前",
      className: "font-semibold text-[#0972d3]",
      render: (g) => <span data-testid={`pgroup-row-${g.name}`}>{g.name}</span>,
    },
    { key: "family", header: "ファミリー" },
    { key: "description", header: "説明" },
    {
      key: "actions",
      header: null,
      className: "text-right",
      render: (g) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void deleteGroup(g);
          }}
          data-testid="pgroups-delete"
          className="text-[13px] font-semibold text-[#d13212] hover:underline"
        >
          削除
        </button>
      ),
    },
  ];

  const paramColumns: Column<DbParameter>[] = [
    { key: "name", header: "名前", className: "font-semibold" },
    { key: "value", header: "値", render: (p) => p.value ?? <span className="text-[#5f6b7a]">-</span> },
    {
      key: "description",
      header: "説明",
      render: (p) => p.description ?? <span className="text-[#5f6b7a]">-</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="パラメータグループ"
          count={unsupported ? undefined : groups.length}
          titleTestId="pgroups-heading"
          countTestId="pgroups-count"
        >
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="pgroups-create">
              パラメータグループを作成
            </Button>
          )}
        </PageHeader>

        {unsupported && (
          <div
            data-testid="parameter-groups-unsupported"
            className="m-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">
              このエミュレータは RDS パラメータグループ API をサポートしていません
            </div>
            <div className="mt-1 text-amber-800">{unsupported.message}</div>
          </div>
        )}

        <ErrorBanner error={error} onRetry={retry} />

        {!unsupported && (
          <div
            data-testid="pgroups-table"
            className="mb-[14px] overflow-x-auto rounded-[10px] border border-[#d9dee3] bg-white shadow-[0_1px_2px_rgba(0,21,41,.08)]"
          >
            <DataTable
              variant="list"
              columns={groupColumns}
              rows={groups}
              rowKey={(g) => g.name}
              loading={loading}
              onRowClick={(g) => void selectGroup(g.name)}
              emptyText={<span data-testid="pgroups-empty">パラメータグループがありません</span>}
            />
          </div>
        )}

        {!unsupported && selected && (
          <Card title={`パラメータ: ${selected}`} overflowHidden>
            <div data-testid="pg-params-table">
              <DataTable
                variant="list"
                columns={paramColumns}
                rows={params}
                rowKey={(p) => p.name}
                loading={paramsLoading && params.length === 0}
                emptyText={<span data-testid="pg-params-empty">パラメータがありません</span>}
              />
            </div>
            {marker && (
              <div className="border-t border-[#e9ecef] p-3 text-center">
                <Button
                  onClick={() => void loadParameters(selected, marker)}
                  data-testid="pg-params-more"
                  disabled={paramsLoading}
                >
                  {paramsLoading ? "読み込み中..." : "続きを読み込む"}
                </Button>
              </div>
            )}
          </Card>
        )}

        {creating && (
          <CreateParameterGroupModal onSubmit={createGroup} onClose={() => setCreating(false)} />
        )}
      </div>
    </ConnectionRequired>
  );
}
