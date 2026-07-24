import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface MskClusterSummary {
  arn: string;
  name: string;
  state: string;
  numberOfBrokerNodes: number | null;
  kafkaVersion: string | null;
}

export interface BootstrapBrokers {
  plaintext: string | null;
  tls: string | null;
}

export const msk = {
  listClusters: (profile: ConnectionProfile) =>
    invoke<MskClusterSummary[]>("msk_list_clusters", { profile }),
  createCluster: (profile: ConnectionProfile, name: string, numBrokers: number) =>
    invoke<void>("msk_create_cluster", { profile, name, numBrokers }),
  deleteCluster: (profile: ConnectionProfile, arn: string) =>
    invoke<void>("msk_delete_cluster", { profile, arn }),
  describeCluster: (profile: ConnectionProfile, arn: string) =>
    invoke<MskClusterSummary>("msk_describe_cluster", { profile, arn }),
  getBootstrapBrokers: (profile: ConnectionProfile, arn: string) =>
    invoke<BootstrapBrokers>("msk_get_bootstrap_brokers", { profile, arn }),
};
