import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface QueryRef {
  executionId: string;
}

export interface QueryStatus {
  state: string;
  reason: string | null;
}

export interface QueryResults {
  columns: string[];
  rows: string[][];
}

export interface WorkgroupSummary {
  name: string;
  description: string | null;
  state: string | null;
}

export interface NamedQuerySummary {
  id: string;
  name: string;
  database: string | null;
  description: string | null;
  queryString: string;
}

export interface NamedQueryRef {
  namedQueryId: string;
}

export const athena = {
  startQuery: (profile: ConnectionProfile, query: string, workgroup?: string) =>
    invoke<QueryRef>("athena_start_query", { profile, query, workgroup }),
  getQueryExecution: (profile: ConnectionProfile, executionId: string) =>
    invoke<QueryStatus>("athena_get_query_execution", { profile, executionId }),
  getQueryResults: (profile: ConnectionProfile, executionId: string) =>
    invoke<QueryResults>("athena_get_query_results", { profile, executionId }),
  listWorkgroups: (profile: ConnectionProfile) =>
    invoke<WorkgroupSummary[]>("athena_list_workgroups", { profile }),
  createWorkgroup: (profile: ConnectionProfile, name: string, description?: string) =>
    invoke<void>("athena_create_workgroup", { profile, name, description }),
  deleteWorkgroup: (profile: ConnectionProfile, name: string) =>
    invoke<void>("athena_delete_workgroup", { profile, name }),
  listNamedQueries: (profile: ConnectionProfile) =>
    invoke<NamedQuerySummary[]>("athena_list_named_queries", { profile }),
  createNamedQuery: (
    profile: ConnectionProfile,
    name: string,
    query: string,
    database?: string,
  ) => invoke<NamedQueryRef>("athena_create_named_query", { profile, name, query, database }),
  deleteNamedQuery: (profile: ConnectionProfile, id: string) =>
    invoke<void>("athena_delete_named_query", { profile, id }),
};
