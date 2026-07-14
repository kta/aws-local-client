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

export type AppError = { kind: string; message: string };

// Per-service wire types live under src/api/types/<service>.ts and are re-exported
// here so existing `import ... from "../api/types"` call sites keep working.
export type {
  KeyDef,
  IndexDetail,
  TableDetail,
  Filter,
  ScanRequest,
  SkCondition,
  QueryRequest,
  PageResult,
  PartiqlResult,
  KeyAttr,
  GsiSpec,
  CreateTableRequest,
  BackupSummary,
} from "./types/dynamodb";
