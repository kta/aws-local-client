import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface DomainSummary {
  name: string;
  engineVersion: string | null;
  processing: boolean;
  created: boolean;
}

export interface DomainDetail {
  name: string;
  endpoint: string | null;
  engineVersion: string | null;
  processing: boolean;
  created: boolean;
}

export const opensearch = {
  listDomains: (profile: ConnectionProfile) =>
    invoke<DomainSummary[]>("opensearch_list_domains", { profile }),
  createDomain: (profile: ConnectionProfile, name: string) =>
    invoke<void>("opensearch_create_domain", { profile, name }),
  deleteDomain: (profile: ConnectionProfile, name: string) =>
    invoke<void>("opensearch_delete_domain", { profile, name }),
  getDomain: (profile: ConnectionProfile, name: string) =>
    invoke<DomainDetail>("opensearch_get_domain", { profile, name }),
};
