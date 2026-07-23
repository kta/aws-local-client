import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

/** Kind discriminator mirrored from the Rust CacheSummary. */
export type CacheKind = "replicationGroup" | "cacheCluster";

/** Engine choices offered in the create modal (redis/valkey → replication group,
 *  memcached → cache cluster). */
export type CacheEngine = "redis" | "valkey" | "memcached";

/**
 * Unified cache summary merged from DescribeReplicationGroups (redis/valkey) and
 * DescribeCacheClusters (memcached) by the Rust `elasticache_list_caches`
 * command. Mirrors `commands::elasticache::CacheSummary`.
 */
export interface CacheSummary {
  id: string;
  kind: CacheKind;
  engine: string;
  status: string;
  nodeType: string | null;
  numNodes: number;
  endpoint: string | null;
}

export interface CreateCacheRequest {
  id: string;
  engine: CacheEngine;
  nodeType: string;
  numNodes: number;
}

export const elasticache = {
  listCaches: (profile: ConnectionProfile) =>
    invoke<CacheSummary[]>("elasticache_list_caches", { profile }),
  createCache: (profile: ConnectionProfile, req: CreateCacheRequest) =>
    invoke<void>("elasticache_create_cache", { profile, req }),
  deleteCache: (profile: ConnectionProfile, id: string, kind: CacheKind) =>
    invoke<void>("elasticache_delete_cache", { profile, id, kind }),
  getCache: (profile: ConnectionProfile, id: string, kind: CacheKind) =>
    invoke<CacheSummary>("elasticache_get_cache", { profile, id, kind }),
};
