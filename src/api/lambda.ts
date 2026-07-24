import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface FunctionSummary {
  name: string;
  runtime: string | null;
  handler: string | null;
  description: string | null;
  codeSize: number;
  memorySize: number;
  timeout: number;
  lastModified: string | null;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface FunctionDetail {
  name: string;
  runtime: string | null;
  handler: string | null;
  description: string | null;
  role: string;
  codeSize: number;
  memorySize: number;
  timeout: number;
  codeSha256: string | null;
  lastModified: string | null;
  environment: EnvVar[];
}

export interface CreateFunctionRequest {
  name: string;
  runtime: string;
  handler: string;
  zipPath: string;
  memorySize?: number;
  timeout?: number;
  description?: string;
  environment?: EnvVar[];
}

export interface UpdateFunctionConfigRequest {
  memorySize: number;
  timeout: number;
  description?: string;
  environment: EnvVar[];
}

export interface InvokeResult {
  statusCode: number;
  payload: string;
  functionError: string | null;
  logTail: string | null;
}

export interface LayerSummary {
  name: string;
  arn: string | null;
  version: number;
  versionArn: string | null;
  description: string | null;
  createdDate: string | null;
  compatibleRuntimes: string[];
}

export interface PublishLayerRequest {
  name: string;
  zipPath: string;
  compatibleRuntimes: string[];
  description?: string;
}

export const lambda = {
  listFunctions: (profile: ConnectionProfile) =>
    invoke<FunctionSummary[]>("lambda_list_functions", { profile }),
  getFunction: (profile: ConnectionProfile, name: string) =>
    invoke<FunctionDetail>("lambda_get_function", { profile, name }),
  createFunction: (profile: ConnectionProfile, req: CreateFunctionRequest) =>
    invoke<void>("lambda_create_function", { profile, req }),
  updateFunctionCode: (profile: ConnectionProfile, name: string, zipPath: string) =>
    invoke<void>("lambda_update_function_code", { profile, name, zipPath }),
  updateFunctionConfig: (
    profile: ConnectionProfile,
    name: string,
    req: UpdateFunctionConfigRequest,
  ) => invoke<void>("lambda_update_function_config", { profile, name, req }),
  deleteFunction: (profile: ConnectionProfile, name: string) =>
    invoke<void>("lambda_delete_function", { profile, name }),
  invoke: (profile: ConnectionProfile, name: string, payload: string) =>
    invoke<InvokeResult>("lambda_invoke", { profile, name, payload }),
  listLayers: (profile: ConnectionProfile) =>
    invoke<LayerSummary[]>("lambda_list_layers", { profile }),
  publishLayerVersion: (profile: ConnectionProfile, req: PublishLayerRequest) =>
    invoke<void>("lambda_publish_layer_version", { profile, req }),
  deleteLayerVersion: (profile: ConnectionProfile, name: string, version: number) =>
    invoke<void>("lambda_delete_layer_version", { profile, name, version }),
};
