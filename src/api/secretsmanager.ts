import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface SecretSummary {
  name: string;
  arn: string;
  description: string | null;
  lastChangedDate: string | null;
}

export interface SecretTag {
  key: string;
  value: string;
}

export interface SecretDetail {
  name: string;
  arn: string;
  description: string | null;
  createdDate: string | null;
  lastChangedDate: string | null;
  tags: SecretTag[];
}

export interface SecretValue {
  secretString: string | null;
  versionId: string | null;
  createdDate: string | null;
}

export interface SecretVersion {
  versionId: string;
  stages: string[];
  createdDate: string | null;
}

export const secretsManager = {
  list: (profile: ConnectionProfile) =>
    invoke<SecretSummary[]>("secrets_list", { profile }),
  create: (profile: ConnectionProfile, name: string, secretString: string, description?: string) =>
    invoke<void>("secrets_create", { profile, name, secretString, description }),
  describe: (profile: ConnectionProfile, id: string) =>
    invoke<SecretDetail>("secrets_describe", { profile, id }),
  getValue: (profile: ConnectionProfile, id: string) =>
    invoke<SecretValue>("secrets_get_value", { profile, id }),
  putValue: (profile: ConnectionProfile, id: string, secretString: string) =>
    invoke<void>("secrets_put_value", { profile, id, secretString }),
  listVersions: (profile: ConnectionProfile, id: string) =>
    invoke<SecretVersion[]>("secrets_list_versions", { profile, id }),
  delete: (profile: ConnectionProfile, id: string, force: boolean, recoveryDays?: number) =>
    invoke<void>("secrets_delete", { profile, id, force, recoveryDays }),
  tag: (profile: ConnectionProfile, id: string, key: string, value: string) =>
    invoke<void>("secrets_tag", { profile, id, key, value }),
  untag: (profile: ConnectionProfile, id: string, key: string) =>
    invoke<void>("secrets_untag", { profile, id, key }),
};
