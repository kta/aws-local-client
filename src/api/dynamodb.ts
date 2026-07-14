import { invoke } from "@tauri-apps/api/core";
import type { DdbItem } from "../lib/ddbJson";
import type {
  BackupSummary,
  ConnectionProfile,
  CreateTableRequest,
  PageResult,
  PartiqlResult,
  QueryRequest,
  ScanRequest,
  TableDetail,
} from "./types";

export const ddb = {
  listTables: (profile: ConnectionProfile) => invoke<string[]>("ddb_list_tables", { profile }),
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
  listBackups: (profile: ConnectionProfile) =>
    invoke<BackupSummary[]>("ddb_list_backups", { profile }),
  createBackup: (profile: ConnectionProfile, tableName: string, backupName: string) =>
    invoke<void>("ddb_create_backup", { profile, tableName, backupName }),
  deleteBackup: (profile: ConnectionProfile, backupArn: string) =>
    invoke<void>("ddb_delete_backup", { profile, backupArn }),
  restoreBackup: (profile: ConnectionProfile, backupArn: string, targetTableName: string) =>
    invoke<void>("ddb_restore_backup", { profile, backupArn, targetTableName }),
};
