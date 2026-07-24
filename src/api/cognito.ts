import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface UserPoolSummary {
  id: string;
  name: string;
  createdAt: string | null;
}

export interface UserPoolDetail {
  id: string;
  name: string;
  estimatedUsers: number;
  createdAt: string | null;
}

export interface CognitoUser {
  username: string;
  status: string | null;
  enabled: boolean;
  email: string | null;
  createdAt: string | null;
}

export interface UserPoolClientSummary {
  clientId: string;
  clientName: string;
}

export interface CognitoGroup {
  name: string;
  description: string | null;
}

export const cognito = {
  listUserPools: (profile: ConnectionProfile) =>
    invoke<UserPoolSummary[]>("cognito_list_user_pools", { profile }),
  createUserPool: (profile: ConnectionProfile, name: string) =>
    invoke<void>("cognito_create_user_pool", { profile, name }),
  deleteUserPool: (profile: ConnectionProfile, id: string) =>
    invoke<void>("cognito_delete_user_pool", { profile, id }),
  getUserPool: (profile: ConnectionProfile, id: string) =>
    invoke<UserPoolDetail>("cognito_get_user_pool", { profile, id }),
  listUsers: (profile: ConnectionProfile, poolId: string) =>
    invoke<CognitoUser[]>("cognito_list_users", { profile, poolId }),
  adminCreateUser: (
    profile: ConnectionProfile,
    poolId: string,
    username: string,
    email?: string,
    tempPassword?: string,
  ) =>
    invoke<void>("cognito_admin_create_user", {
      profile,
      poolId,
      username,
      email,
      tempPassword,
    }),
  adminSetUserPassword: (
    profile: ConnectionProfile,
    poolId: string,
    username: string,
    password: string,
    permanent: boolean,
  ) =>
    invoke<void>("cognito_admin_set_user_password", {
      profile,
      poolId,
      username,
      password,
      permanent,
    }),
  adminEnableUser: (profile: ConnectionProfile, poolId: string, username: string) =>
    invoke<void>("cognito_admin_enable_user", { profile, poolId, username }),
  adminDisableUser: (profile: ConnectionProfile, poolId: string, username: string) =>
    invoke<void>("cognito_admin_disable_user", { profile, poolId, username }),
  adminDeleteUser: (profile: ConnectionProfile, poolId: string, username: string) =>
    invoke<void>("cognito_admin_delete_user", { profile, poolId, username }),
  listUserPoolClients: (profile: ConnectionProfile, poolId: string) =>
    invoke<UserPoolClientSummary[]>("cognito_list_user_pool_clients", { profile, poolId }),
  createUserPoolClient: (profile: ConnectionProfile, poolId: string, name: string) =>
    invoke<void>("cognito_create_user_pool_client", { profile, poolId, name }),
  deleteUserPoolClient: (profile: ConnectionProfile, poolId: string, clientId: string) =>
    invoke<void>("cognito_delete_user_pool_client", { profile, poolId, clientId }),
  listGroups: (profile: ConnectionProfile, poolId: string) =>
    invoke<CognitoGroup[]>("cognito_list_groups", { profile, poolId }),
  createGroup: (profile: ConnectionProfile, poolId: string, name: string, description?: string) =>
    invoke<void>("cognito_create_group", { profile, poolId, name, description }),
  deleteGroup: (profile: ConnectionProfile, poolId: string, name: string) =>
    invoke<void>("cognito_delete_group", { profile, poolId, name }),
};
