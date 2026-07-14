import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface DbInstanceSummary {
  id: string;
  engine: string;
  status: string;
  instanceClass: string;
  endpointAddress: string | null;
  endpointPort: number | null;
  allocatedStorage: number | null;
}

export interface CreateDbInstanceRequest {
  id: string;
  engine: string;
  instanceClass: string;
  masterUsername: string;
  masterPassword: string;
  allocatedStorage: number;
}

export interface ModifyInstanceRequest {
  instanceClass?: string;
  allocatedStorage?: number;
}

export interface DbSnapshot {
  id: string;
  instanceId: string;
  status: string;
  createdAt: string | null;
}

export interface DbParameterGroup {
  name: string;
  family: string;
  description: string;
}

export interface DbParameter {
  name: string;
  value: string | null;
  description: string | null;
}

export interface ListParametersResult {
  parameters: DbParameter[];
  marker: string | null;
}

export const rds = {
  listInstances: (profile: ConnectionProfile) =>
    invoke<DbInstanceSummary[]>("rds_list_instances", { profile }),
  createInstance: (profile: ConnectionProfile, req: CreateDbInstanceRequest) =>
    invoke<void>("rds_create_instance", { profile, req }),
  deleteInstance: (profile: ConnectionProfile, id: string) =>
    invoke<void>("rds_delete_instance", { profile, id }),
  stopInstance: (profile: ConnectionProfile, id: string) =>
    invoke<void>("rds_stop_instance", { profile, id }),
  startInstance: (profile: ConnectionProfile, id: string) =>
    invoke<void>("rds_start_instance", { profile, id }),
  rebootInstance: (profile: ConnectionProfile, id: string) =>
    invoke<void>("rds_reboot_instance", { profile, id }),
  modifyInstance: (profile: ConnectionProfile, id: string, req: ModifyInstanceRequest) =>
    invoke<void>("rds_modify_instance", { profile, id, req }),
  listSnapshots: (profile: ConnectionProfile) =>
    invoke<DbSnapshot[]>("rds_list_snapshots", { profile }),
  createSnapshot: (profile: ConnectionProfile, instanceId: string, snapshotId: string) =>
    invoke<void>("rds_create_snapshot", { profile, instanceId, snapshotId }),
  restoreSnapshot: (profile: ConnectionProfile, snapshotId: string, newInstanceId: string) =>
    invoke<void>("rds_restore_snapshot", { profile, snapshotId, newInstanceId }),
  deleteSnapshot: (profile: ConnectionProfile, snapshotId: string) =>
    invoke<void>("rds_delete_snapshot", { profile, snapshotId }),
  listParameterGroups: (profile: ConnectionProfile) =>
    invoke<DbParameterGroup[]>("rds_list_parameter_groups", { profile }),
  createParameterGroup: (
    profile: ConnectionProfile,
    name: string,
    family: string,
    description: string,
  ) => invoke<void>("rds_create_parameter_group", { profile, name, family, description }),
  deleteParameterGroup: (profile: ConnectionProfile, name: string) =>
    invoke<void>("rds_delete_parameter_group", { profile, name }),
  listParameters: (profile: ConnectionProfile, groupName: string, marker?: string) =>
    invoke<ListParametersResult>("rds_list_parameters", { profile, groupName, marker }),
};
