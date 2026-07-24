import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface CfnStackSummary {
  name: string;
  status: string;
  statusReason: string | null;
  createdAt: string | null;
}

export interface CfnParameter {
  key: string;
  value: string;
}

export interface CfnOutput {
  key: string;
  value: string;
  description: string | null;
  exportName: string | null;
}

export interface CfnStackDetail {
  name: string;
  status: string;
  statusReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  outputs: CfnOutput[];
  parameters: CfnParameter[];
}

export interface CfnResource {
  logicalId: string;
  physicalId: string | null;
  resourceType: string;
  status: string;
  timestamp: string | null;
}

export interface CfnStackEvent {
  eventId: string;
  logicalId: string | null;
  resourceType: string | null;
  status: string | null;
  reason: string | null;
  timestamp: string | null;
}

export interface CfnEventsResult {
  events: CfnStackEvent[];
  supported: boolean;
}

export interface CfnExport {
  name: string;
  value: string;
  exportingStackId: string | null;
}

export const cloudformation = {
  listStacks: (profile: ConnectionProfile) =>
    invoke<CfnStackSummary[]>("cfn_list_stacks", { profile }),
  createStack: (
    profile: ConnectionProfile,
    name: string,
    templateBody: string,
    parameters: CfnParameter[],
  ) => invoke<void>("cfn_create_stack", { profile, name, templateBody, parameters }),
  updateStack: (
    profile: ConnectionProfile,
    name: string,
    templateBody: string,
    parameters: CfnParameter[],
  ) => invoke<void>("cfn_update_stack", { profile, name, templateBody, parameters }),
  deleteStack: (profile: ConnectionProfile, name: string) =>
    invoke<void>("cfn_delete_stack", { profile, name }),
  getStack: (profile: ConnectionProfile, name: string) =>
    invoke<CfnStackDetail>("cfn_get_stack", { profile, name }),
  listResources: (profile: ConnectionProfile, name: string) =>
    invoke<CfnResource[]>("cfn_list_resources", { profile, name }),
  listEvents: (profile: ConnectionProfile, name: string) =>
    invoke<CfnEventsResult>("cfn_list_events", { profile, name }),
  getTemplate: (profile: ConnectionProfile, name: string) =>
    invoke<string>("cfn_get_template", { profile, name }),
  listExports: (profile: ConnectionProfile) =>
    invoke<CfnExport[]>("cfn_list_exports", { profile }),
};
