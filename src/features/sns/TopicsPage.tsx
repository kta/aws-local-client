import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { TopicSummary } from "../../api/sns";
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
} from "../../components/ui";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateTopicModal } from "./CreateTopicModal";

export function TopicsPage() {
  const { active } = useConnections();
  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<TopicSummary[]>((profile) => api.sns.listTopics(profile));
  const topics = data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<AppError | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TopicSummary | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open the create-topic modal automatically when navigated here with ?create=1
  // (e.g. from the dashboard quick action), then clear the flag from the URL.
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const createTopic = async (name: string, fifo: boolean) => {
    if (!active) return;
    try {
      await api.sns.createTopic(active, name, fifo);
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const selectedName = selected.size === 1 ? [...selected][0] : null;
  const selectedTopic = selectedName ? topics.find((t) => t.name === selectedName) ?? null : null;

  const columns: Column<TopicSummary>[] = [
    {
      key: "name",
      header: "名前",
      render: (t) => (
        <Link
          to={`/sns/topics/${encodeURIComponent(t.name)}`}
          data-testid={`topic-link-${t.name}`}
          className="font-semibold text-[#0972d3] no-underline hover:underline"
        >
          {t.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "種別",
      render: (t) => (
        <span className="text-[12.5px] font-semibold text-[#5f6b7a]">
          {t.fifo ? "FIFO" : "Standard"}
        </span>
      ),
    },
    {
      key: "arn",
      header: "ARN",
      render: (t) => <span className="font-mono text-[12px] text-[#5f6b7a]">{t.topicArn}</span>,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader
          title="トピック"
          count={topics.length}
          titleTestId="topics-heading"
          countTestId="topics-count"
        >
          <button
            onClick={() => selectedTopic && setDeleting(selectedTopic)}
            disabled={selected.size !== 1}
            data-testid="topics-delete"
            className="rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[14px] py-[6px] text-[13px] font-semibold text-[#d13212] hover:border-[#5f6b7a] disabled:cursor-not-allowed disabled:opacity-45"
          >
            削除
          </button>
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="topics-create">
            トピックの作成
          </Button>
        </PageHeader>

        <ErrorBanner error={actionError ?? fetchError} onRetry={reload} />

        <Card className="overflow-x-auto">
          <DataTable
            variant="list"
            columns={columns}
            rows={topics}
            rowKey={(t) => t.name}
            loading={loading}
            emptyText={fetchError ? undefined : "トピックがありません"}
            selection={{
              isSelected: (t) => selected.has(t.name),
              onToggle: (t) => toggle(t.name),
              ariaLabel: (t) => `${t.name} を選択`,
            }}
          />
        </Card>

        {creating && (
          <CreateTopicModal onSubmit={createTopic} onClose={() => setCreating(false)} />
        )}

        {deleting && (
          <ConfirmDangerModal
            title="トピックの削除"
            description={
              <>
                トピック <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
                を削除します。確認のためトピック名を入力してください。
              </>
            }
            requiredText={deleting.name}
            confirmLabel="削除"
            onConfirm={async () => {
              if (!active) return;
              await api.sns.deleteTopic(active, deleting.topicArn);
              setDeleting(null);
              setSelected(new Set());
              await reload();
            }}
            onClose={() => setDeleting(null)}
            inputTestId="topics-delete-input"
            confirmTestId="topics-delete-confirm"
          />
        )}
      </div>
    </ConnectionRequired>
  );
}
