import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface ApiSummary {
  id: string;
  name: string;
  description: string | null;
  createdDate: string | null;
}

export interface ApiResource {
  id: string;
  path: string;
  parentId: string | null;
  methods: string[];
}

export interface StageSummary {
  stageName: string;
  deploymentId: string | null;
  createdDate: string | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  enabled: boolean;
  createdDate: string | null;
}

export interface MethodIntegration {
  kind: "mock" | "lambdaProxy";
  lambdaArn?: string;
}

export const apigateway = {
  listApis: (profile: ConnectionProfile) => invoke<ApiSummary[]>("apigw_list_apis", { profile }),
  createApi: (profile: ConnectionProfile, name: string, description?: string) =>
    invoke<ApiSummary>("apigw_create_api", { profile, name, description }),
  deleteApi: (profile: ConnectionProfile, id: string) =>
    invoke<void>("apigw_delete_api", { profile, id }),
  getResources: (profile: ConnectionProfile, apiId: string) =>
    invoke<ApiResource[]>("apigw_get_resources", { profile, apiId }),
  createResource: (
    profile: ConnectionProfile,
    apiId: string,
    parentId: string,
    pathPart: string,
  ) => invoke<ApiResource>("apigw_create_resource", { profile, apiId, parentId, pathPart }),
  putMethod: (
    profile: ConnectionProfile,
    apiId: string,
    resourceId: string,
    httpMethod: string,
    integration: MethodIntegration,
  ) => invoke<void>("apigw_put_method", { profile, apiId, resourceId, httpMethod, integration }),
  createDeployment: (profile: ConnectionProfile, apiId: string, stageName: string) =>
    invoke<StageSummary>("apigw_create_deployment", { profile, apiId, stageName }),
  listStages: (profile: ConnectionProfile, apiId: string) =>
    invoke<StageSummary[]>("apigw_list_stages", { profile, apiId }),
  listApiKeys: (profile: ConnectionProfile) =>
    invoke<ApiKeySummary[]>("apigw_list_api_keys", { profile }),
  createApiKey: (profile: ConnectionProfile, name: string) =>
    invoke<ApiKeySummary>("apigw_create_api_key", { profile, name }),
  deleteApiKey: (profile: ConnectionProfile, id: string) =>
    invoke<void>("apigw_delete_api_key", { profile, id }),
};
