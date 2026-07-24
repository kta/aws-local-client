import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export type ParameterType = "String" | "StringList" | "SecureString";

export interface ParameterSummary {
  name: string;
  type: ParameterType;
  version: number;
  lastModified: string | null;
}

export interface ParameterValue {
  name: string;
  type: ParameterType;
  value: string;
  version: number;
}

export interface ParameterHistoryEntry {
  version: number;
  value: string;
  type: ParameterType;
  lastModified: string | null;
}

export interface PutParameterRequest {
  name: string;
  value: string;
  type: ParameterType;
  overwrite: boolean;
  description?: string;
}

export const ssm = {
  listParameters: (profile: ConnectionProfile, prefix?: string) =>
    invoke<ParameterSummary[]>("ssm_list_parameters", { profile, prefix: prefix ?? null }),
  getParameter: (profile: ConnectionProfile, name: string, withDecryption: boolean) =>
    invoke<ParameterValue>("ssm_get_parameter", { profile, name, withDecryption }),
  putParameter: (profile: ConnectionProfile, req: PutParameterRequest) =>
    invoke<void>("ssm_put_parameter", { profile, req }),
  deleteParameter: (profile: ConnectionProfile, name: string) =>
    invoke<void>("ssm_delete_parameter", { profile, name }),
  getParameterHistory: (profile: ConnectionProfile, name: string) =>
    invoke<ParameterHistoryEntry[]>("ssm_get_parameter_history", { profile, name }),
};
