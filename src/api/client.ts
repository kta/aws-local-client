import { invoke } from "@tauri-apps/api/core";
import type { AppError, ConnectionProfile, DetectedEndpoint } from "./types";
import { ddb } from "./dynamodb";
import { lambda } from "./lambda";
import { rds } from "./rds";
import { s3 } from "./s3";
import { sns } from "./sns";
import { sqs } from "./sqs";

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

  ddb,
  sqs,
  sns,
  s3,
  rds,
  lambda,
};
