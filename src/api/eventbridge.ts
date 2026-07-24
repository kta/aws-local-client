import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface EventBusSummary {
  name: string;
  arn: string | null;
}

export interface RuleSummary {
  name: string;
  arn: string | null;
  state: string;
  scheduleExpression: string | null;
  eventPattern: string | null;
  description: string | null;
  eventBusName: string;
}

export interface TargetSummary {
  id: string;
  arn: string;
}

export interface PutRuleRequest {
  name: string;
  bus: string;
  scheduleExpression?: string;
  eventPattern?: string;
  description?: string;
  enabled: boolean;
}

export interface PutEventsResult {
  failedCount: number;
  eventIds: string[];
}

export const eventbridge = {
  listBuses: (profile: ConnectionProfile) =>
    invoke<EventBusSummary[]>("events_list_buses", { profile }),
  createBus: (profile: ConnectionProfile, name: string) =>
    invoke<void>("events_create_bus", { profile, name }),
  deleteBus: (profile: ConnectionProfile, name: string) =>
    invoke<void>("events_delete_bus", { profile, name }),
  listRules: (profile: ConnectionProfile, bus: string) =>
    invoke<RuleSummary[]>("events_list_rules", { profile, bus }),
  putRule: (profile: ConnectionProfile, req: PutRuleRequest) =>
    invoke<void>("events_put_rule", { profile, req }),
  deleteRule: (profile: ConnectionProfile, name: string, bus: string) =>
    invoke<void>("events_delete_rule", { profile, name, bus }),
  enableRule: (profile: ConnectionProfile, name: string, bus: string) =>
    invoke<void>("events_enable_rule", { profile, name, bus }),
  disableRule: (profile: ConnectionProfile, name: string, bus: string) =>
    invoke<void>("events_disable_rule", { profile, name, bus }),
  listTargets: (profile: ConnectionProfile, rule: string, bus: string) =>
    invoke<TargetSummary[]>("events_list_targets", { profile, rule, bus }),
  putTarget: (profile: ConnectionProfile, rule: string, bus: string, targetId: string, arn: string) =>
    invoke<void>("events_put_target", { profile, rule, bus, targetId, arn }),
  removeTarget: (profile: ConnectionProfile, rule: string, bus: string, targetId: string) =>
    invoke<void>("events_remove_target", { profile, rule, bus, targetId }),
  putEvents: (
    profile: ConnectionProfile,
    bus: string,
    source: string,
    detailType: string,
    detail: string,
  ) => invoke<PutEventsResult>("events_put_events", { profile, bus, source, detailType, detail }),
};
