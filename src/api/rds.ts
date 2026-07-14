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

export const rds = {
  listInstances: (profile: ConnectionProfile) =>
    invoke<DbInstanceSummary[]>("rds_list_instances", { profile }),
  createInstance: (profile: ConnectionProfile, req: CreateDbInstanceRequest) =>
    invoke<void>("rds_create_instance", { profile, req }),
  deleteInstance: (profile: ConnectionProfile, id: string) =>
    invoke<void>("rds_delete_instance", { profile, id }),
};
