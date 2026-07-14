import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { AppError, CreateTableRequest, KeyDef, TableDetail } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConfirmDangerModal,
  ConnectionRequired,
  DataTable,
  KeyChip,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateTableModal } from "./CreateTableModal";

type RowState =
  | { status: "loading" }
  | { status: "loaded"; detail: TableDetail }
  | { status: "error" };

function findKey(detail: TableDetail, keyType: KeyDef["keyType"]): KeyDef | undefined {
  return detail.keys.find((k) => k.keyType === keyType);
}

export function TablesPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<string[]>((profile) => api.ddb.listTables(profile));
  const tables = data ?? [];
  const [details, setDetails] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the create-table modal automatically when navigated here with ?create=1
  // (e.g. from the dashboard quick action), then clear the flag from the URL.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Per-row async describe to fill status / keys / index count. Failures are
  // tolerated per row. Runs whenever the table list (re)loads; also resets the
  // selection so a stale tick never survives a reload.
  useEffect(() => {
    const names = data ?? [];
    setSelected(new Set());
    setDetails(Object.fromEntries(names.map((t) => [t, { status: "loading" } as RowState])));
    if (!active || names.length === 0) return;
    let cancelled = false;
    for (const name of names) {
      api.ddb
        .describeTable(active, name)
        .then((detail) => {
          if (!cancelled) setDetails((prev) => ({ ...prev, [name]: { status: "loaded", detail } }));
        })
        .catch(() => {
          if (!cancelled) setDetails((prev) => ({ ...prev, [name]: { status: "error" } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active, data]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createTable = async (req: CreateTableRequest) => {
    if (!active) return;
    try {
      await api.ddb.createTable(active, req);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;

  const detailOf = (t: string): TableDetail | null => {
    const row = details[t];
    return row?.status === "loaded" ? row.detail : null;
  };

  const columns: Column<string>[] = [
    {
      key: "name",
      header: "名前",
      render: (t) => (
        <Link
          to={`/dynamodb/tables/${encodeURIComponent(t)}`}
          data-testid={`table-link-${t}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {t}
        </Link>
      ),
    },
    {
      key: "status",
      header: "ステータス",
      render: (t) => {
        const row = details[t];
        if (!row || row.status !== "loaded") return <span className="text-[#5f6b7a]">-</span>;
        return <StatusBadge status={row.detail.status} />;
      },
    },
    {
      key: "pk",
      header: "パーティションキー",
      render: (t) => {
        const detail = detailOf(t);
        return <KeyChip keyDef={detail ? findKey(detail, "HASH") : null} />;
      },
    },
    {
      key: "sk",
      header: "ソートキー",
      render: (t) => {
        const detail = detailOf(t);
        return <KeyChip keyDef={detail ? findKey(detail, "RANGE") : null} />;
      },
    },
    {
      key: "indexes",
      header: "インデックス",
      render: (t) => {
        const detail = detailOf(t);
        return detail ? detail.gsis.length + detail.lsis.length : <span className="text-[#5f6b7a]">-</span>;
      },
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="テーブル"
          count={tables.length}
          titleTestId="tables-heading"
          countTestId="tables-count"
        >
          <button
            onClick={() => selectedName && setDeletingName(selectedName)}
            disabled={selected.size !== 1}
            data-testid="tables-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="tables-create">
            テーブルの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={tables}
            rowKey={(t) => t}
            loading={loading}
            emptyText={fetchError ? undefined : "テーブルがありません"}
            selection={{
              isSelected: (t) => selected.has(t),
              onToggle: (t) => toggle(t),
              ariaLabel: (t) => `${t} を選択`,
            }}
          />
        </Card>

        {creating && <CreateTableModal onSubmit={createTable} onClose={() => setCreating(false)} />}

        {deletingName && (
          <ConfirmDangerModal
            title="テーブルの削除"
            description={
              <>
                テーブル <b className="font-mono text-[#16191f]">{deletingName}</b>{" "}
                を削除します。確認のためテーブル名を入力してください。
              </>
            }
            requiredText={deletingName}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.ddb.deleteTable(active, deletingName);
              setDeletingName(null);
              await reload();
            }}
            onClose={() => setDeletingName(null)}
            inputTestId="tables-delete-input"
            confirmTestId="tables-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
