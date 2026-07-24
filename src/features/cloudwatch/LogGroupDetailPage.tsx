import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type { LogEvent, LogStream } from "../../api/cloudwatch";
import type { AppError } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  type Column,
  ConnectionRequired,
  DataTable,
  PageHeader,
} from "../../components/ui";
import { formatBytes, formatDate } from "../../lib/format";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";

export function LogGroupDetailPage() {
  const { name } = useParams<{ name: string }>();
  const group = decodeURIComponent(name ?? "");
  const { active } = useConnections();

  const {
    data,
    error: fetchError,
    loading,
    reload,
  } = useProfileScopedFetch<LogStream[]>(
    (profile) => api.cloudwatch.listLogStreams(profile, group),
    [group],
  );
  const streams = data ?? [];

  const [selectedStream, setSelectedStream] = useState<string | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventError, setEventError] = useState<AppError | null>(null);
  const [filter, setFilter] = useState("");
  const [filtered, setFiltered] = useState(false);

  const openStream = async (stream: string) => {
    if (!active) return;
    setSelectedStream(stream);
    setFiltered(false);
    setEventsLoading(true);
    setEventError(null);
    try {
      setEvents(await api.cloudwatch.getLogEvents(active, group, stream));
    } catch (e) {
      setEventError(toAppError(e));
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const runFilter = async () => {
    if (!active) return;
    setSelectedStream(null);
    setFiltered(true);
    setEventsLoading(true);
    setEventError(null);
    try {
      setEvents(await api.cloudwatch.filterLogEvents(active, group, filter.trim()));
    } catch (e) {
      setEventError(toAppError(e));
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const streamColumns: Column<LogStream>[] = [
    {
      key: "name",
      header: "ストリーム",
      render: (s) => (
        <button
          type="button"
          data-testid={`stream-link-${s.name}`}
          onClick={() => openStream(s.name)}
          className="font-semibold text-[#0972d3] hover:underline"
        >
          {s.name}
        </button>
      ),
    },
    { key: "last", header: "最終イベント", render: (s) => formatDate(s.lastEventAt) },
    { key: "size", header: "サイズ", render: (s) => formatBytes(s.storedBytes) },
  ];

  const eventColumns: Column<LogEvent>[] = [
    { key: "ts", header: "タイムスタンプ", render: (e) => formatDate(e.timestamp) },
    ...(filtered
      ? [
          {
            key: "stream",
            header: "ストリーム",
            render: (e: LogEvent) => e.stream ?? "-",
          } satisfies Column<LogEvent>,
        ]
      : []),
    {
      key: "message",
      header: "メッセージ",
      className: "font-mono text-[12.5px]",
      render: (e) => e.message,
    },
  ];

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <PageHeader title={group} titleTestId="log-group-detail-heading" />

        <ErrorBanner error={fetchError} onRetry={reload} />

        <div className="mb-[14px]">
          <Card title="ログストリーム" overflowHidden>
            <DataTable
              variant="list"
              columns={streamColumns}
              rows={streams}
              rowKey={(s) => s.name}
              loading={loading}
              emptyText={fetchError ? undefined : "ログストリームがありません"}
              rowTestId="stream-row"
            />
          </Card>
        </div>

        <div className="mb-[10px] flex flex-wrap items-end gap-[10px]">
          <label className="block text-sm">
            <span className="text-gray-600">フィルタパターン</span>
            <input
              className="mt-1 w-[280px] rounded border border-gray-300 px-2 py-1"
              data-testid="log-filter-input"
              value={filter}
              placeholder="例: ERROR"
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <Button variant="primary" onClick={runFilter} data-testid="log-filter-run">
            検索
          </Button>
        </div>

        <ErrorBanner error={eventError} />

        <Card
          title={filtered ? "検索結果" : selectedStream ? `イベント: ${selectedStream}` : "イベント"}
          overflowHidden
        >
          <DataTable
            variant="list"
            columns={eventColumns}
            rows={events}
            rowKey={(_, i) => String(i)}
            loading={eventsLoading}
            emptyText={
              selectedStream || filtered
                ? "イベントがありません"
                : "ストリームを選択するか、フィルタで検索してください"
            }
            rowTestId="log-event-row"
          />
        </Card>
      </div>
    </ConnectionRequired>
  );
}
