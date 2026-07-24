import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

// ---- Logs (aws-sdk-cloudwatchlogs) ------------------------------------------

export interface LogGroup {
  name: string;
  retentionInDays: number | null;
  storedBytes: number;
  createdAt: string | null;
}

export interface LogStream {
  name: string;
  lastEventAt: string | null;
  storedBytes: number;
}

export interface LogEvent {
  timestamp: string | null;
  message: string;
  stream: string | null;
}

// ---- Metrics / Alarms (legacy Query protocol, see cloudwatch_query.rs) -------

export interface CwDimension {
  name: string;
  value: string;
}

export interface MetricSummary {
  namespace: string;
  name: string;
  dimensions: CwDimension[];
}

export interface Datapoint {
  timestamp: string;
  value: number;
}

export interface GetMetricStatisticsRequest {
  namespace: string;
  metricName: string;
  dimensions: CwDimension[];
  periodSec: number;
  /** Average | Sum | Maximum | Minimum | SampleCount */
  stat: string;
  startIso: string;
  endIso: string;
}

export interface AlarmSummary {
  name: string;
  state: string;
  metricName: string | null;
  namespace: string | null;
  threshold: number | null;
  comparisonOperator: string | null;
  statistic: string | null;
}

export interface PutMetricAlarmRequest {
  name: string;
  namespace: string;
  metricName: string;
  stat: string;
  periodSec: number;
  threshold: number;
  comparison: string;
}

export const cloudwatch = {
  // Logs
  listLogGroups: (profile: ConnectionProfile) =>
    invoke<LogGroup[]>("cw_list_log_groups", { profile }),
  createLogGroup: (profile: ConnectionProfile, name: string) =>
    invoke<void>("cw_create_log_group", { profile, name }),
  deleteLogGroup: (profile: ConnectionProfile, name: string) =>
    invoke<void>("cw_delete_log_group", { profile, name }),
  listLogStreams: (profile: ConnectionProfile, group: string) =>
    invoke<LogStream[]>("cw_list_log_streams", { profile, group }),
  getLogEvents: (profile: ConnectionProfile, group: string, stream: string) =>
    invoke<LogEvent[]>("cw_get_log_events", { profile, group, stream }),
  filterLogEvents: (profile: ConnectionProfile, group: string, pattern: string) =>
    invoke<LogEvent[]>("cw_filter_log_events", { profile, group, pattern }),

  // Metrics / Alarms
  listMetrics: (profile: ConnectionProfile, namespace?: string) =>
    invoke<MetricSummary[]>("cw_list_metrics", { profile, namespace }),
  getMetricStatistics: (profile: ConnectionProfile, req: GetMetricStatisticsRequest) =>
    invoke<Datapoint[]>("cw_get_metric_statistics", { profile, req }),
  describeAlarms: (profile: ConnectionProfile) =>
    invoke<AlarmSummary[]>("cw_describe_alarms", { profile }),
  putMetricAlarm: (profile: ConnectionProfile, req: PutMetricAlarmRequest) =>
    invoke<void>("cw_put_metric_alarm", { profile, req }),
  deleteAlarms: (profile: ConnectionProfile, names: string[]) =>
    invoke<void>("cw_delete_alarms", { profile, names }),
};
