import { invoke } from "@tauri-apps/api/core";
import type { DdbItem } from "../lib/ddbJson";
import type {
  AppError,
  ConnectionProfile,
  CreateTableRequest,
  DetectedEndpoint,
  PageResult,
  PartiqlResult,
  QueryRequest,
  ScanRequest,
  TableDetail,
} from "./types";

export function toAppError(e: unknown): AppError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    return e as AppError;
  }
  return { kind: "internal", message: String(e) };
}

export const api = {
  listConnections: () => invoke<ConnectionProfile[]>("list_connections"),
  saveConnection: (profile: ConnectionProfile) =>
    invoke<ConnectionProfile[]>("save_connection", { profile }),
  deleteConnection: (id: string) =>
    invoke<ConnectionProfile[]>("delete_connection", { id }),
  detectConnections: () => invoke<DetectedEndpoint[]>("detect_connections"),

  ddb: {
    listTables: (profile: ConnectionProfile) =>
      invoke<string[]>("ddb_list_tables", { profile }),
    describeTable: (profile: ConnectionProfile, tableName: string) =>
      invoke<TableDetail>("ddb_describe_table", { profile, tableName }),
    scan: (profile: ConnectionProfile, req: ScanRequest) =>
      invoke<PageResult>("ddb_scan", { profile, req }),
    query: (profile: ConnectionProfile, req: QueryRequest) =>
      invoke<PageResult>("ddb_query", { profile, req }),
    putItem: (profile: ConnectionProfile, tableName: string, item: DdbItem) =>
      invoke<void>("ddb_put_item", { profile, tableName, item }),
    deleteItem: (profile: ConnectionProfile, tableName: string, key: DdbItem) =>
      invoke<void>("ddb_delete_item", { profile, tableName, key }),
    createTable: (profile: ConnectionProfile, req: CreateTableRequest) =>
      invoke<void>("ddb_create_table", { profile, req }),
    deleteTable: (profile: ConnectionProfile, tableName: string) =>
      invoke<void>("ddb_delete_table", { profile, tableName }),
    executeStatement: (profile: ConnectionProfile, statement: string, nextToken?: string) =>
      invoke<PartiqlResult>("ddb_execute_statement", { profile, statement, nextToken }),
  },
};
