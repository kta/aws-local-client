import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface HostedZoneSummary {
  id: string;
  name: string;
  recordCount: number;
  privateZone: boolean;
}

export interface RecordSet {
  name: string;
  recordType: string;
  ttl: number | null;
  values: string[];
}

export interface HealthCheckSummary {
  id: string;
  target: string;
  port: number | null;
  checkType: string;
  resourcePath: string | null;
}

export interface CreateHealthCheckRequest {
  target: string;
  port: number;
  checkType: string;
  resourcePath?: string;
}

export type ChangeAction = "CREATE" | "UPSERT" | "DELETE";

export const route53 = {
  listHostedZones: (profile: ConnectionProfile) =>
    invoke<HostedZoneSummary[]>("route53_list_hosted_zones", { profile }),
  createHostedZone: (profile: ConnectionProfile, name: string) =>
    invoke<void>("route53_create_hosted_zone", { profile, name }),
  deleteHostedZone: (profile: ConnectionProfile, id: string) =>
    invoke<void>("route53_delete_hosted_zone", { profile, id }),
  listRecordSets: (profile: ConnectionProfile, zoneId: string) =>
    invoke<RecordSet[]>("route53_list_record_sets", { profile, zoneId }),
  changeRecordSet: (
    profile: ConnectionProfile,
    zoneId: string,
    action: ChangeAction,
    record: RecordSet,
  ) => invoke<void>("route53_change_record_set", { profile, zoneId, action, record }),
  listHealthChecks: (profile: ConnectionProfile) =>
    invoke<HealthCheckSummary[]>("route53_list_health_checks", { profile }),
  createHealthCheck: (profile: ConnectionProfile, req: CreateHealthCheckRequest) =>
    invoke<void>("route53_create_health_check", { profile, req }),
  deleteHealthCheck: (profile: ConnectionProfile, id: string) =>
    invoke<void>("route53_delete_health_check", { profile, id }),
};
