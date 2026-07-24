import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface RepositorySummary {
  name: string;
  uri: string;
  arn: string;
  createdAt: string | null;
}

export interface EcrImage {
  tag: string | null;
  digest: string | null;
  sizeBytes: number | null;
  pushedAt: string | null;
}

export const ecr = {
  listRepositories: (profile: ConnectionProfile) =>
    invoke<RepositorySummary[]>("ecr_list_repositories", { profile }),
  createRepository: (profile: ConnectionProfile, name: string) =>
    invoke<void>("ecr_create_repository", { profile, name }),
  deleteRepository: (profile: ConnectionProfile, name: string, force: boolean) =>
    invoke<void>("ecr_delete_repository", { profile, name, force }),
  listImages: (profile: ConnectionProfile, name: string) =>
    invoke<EcrImage[]>("ecr_list_images", { profile, name }),
};
