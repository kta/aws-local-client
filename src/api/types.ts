import type { DdbItem } from "../lib/ddbJson";

export type ConnectionProfile = {
  id: string;
  name: string;
  endpointUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  color?: string | null;
};

export type DetectedEndpoint = { endpointUrl: string; tableCount: number };

export type KeyDef = { name: string; keyType: "HASH" | "RANGE"; attrType: string };
export type IndexDetail = { name: string; keys: KeyDef[] };
export type TableDetail = {
  name: string;
  status: string;
  itemCount: number;
  sizeBytes: number;
  keys: KeyDef[];
  gsis: IndexDetail[];
  lsis: IndexDetail[];
};

export type Filter = { attr: string; op: "eq" | "contains"; value: unknown };
export type ScanRequest = {
  tableName: string;
  limit: number;
  startKey?: DdbItem | null;
  filter?: Filter | null;
};
export type SkCondition = { name: string; op: "eq" | "begins_with"; value: unknown };
export type QueryRequest = {
  tableName: string;
  indexName?: string | null;
  pkName: string;
  pkValue: unknown;
  sk?: SkCondition | null;
  limit: number;
  startKey?: DdbItem | null;
};
export type PageResult = {
  items: DdbItem[];
  lastKey: DdbItem | null;
  count: number;
  scannedCount: number;
};

export interface PartiqlResult {
  items: DdbItem[];
  nextToken?: string;
}

export type KeyAttr = { name: string; attrType: "S" | "N" | "B" };
export type GsiSpec = { name: string; pk: KeyAttr; sk?: KeyAttr | null };
export type CreateTableRequest = {
  tableName: string;
  pk: KeyAttr;
  sk?: KeyAttr | null;
  gsis: GsiSpec[];
};

export interface BackupSummary {
  backupArn: string;
  backupName: string;
  tableName: string;
  status: string;
  sizeBytes?: number;
  createdAt?: string; // RFC3339
}

export type AppError = { kind: string; message: string };
