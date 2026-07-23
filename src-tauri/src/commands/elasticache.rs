use aws_sdk_elasticache::types::{CacheCluster, Endpoint, ReplicationGroup};
use aws_sdk_elasticache::Client;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Unified summary of a cache, merged from DescribeReplicationGroups
/// (redis/valkey) and DescribeCacheClusters (memcached). The `kind` field tells
/// the UI which delete/get API to route to.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheSummary {
    pub id: String,
    /// "replicationGroup" | "cacheCluster"
    pub kind: String,
    pub engine: String,
    pub status: String,
    pub node_type: Option<String>,
    pub num_nodes: i32,
    /// "address:port" of the (primary/configuration) endpoint when available.
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCacheRequest {
    pub id: String,
    /// "redis" | "valkey" | "memcached"
    pub engine: String,
    pub node_type: String,
    pub num_nodes: i32,
}

pub const KIND_REPLICATION_GROUP: &str = "replicationGroup";
pub const KIND_CACHE_CLUSTER: &str = "cacheCluster";

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

/// Format an SDK endpoint as "address:port" (dropping the port when absent).
fn format_endpoint(ep: Option<&Endpoint>) -> Option<String> {
    let ep = ep?;
    let address = ep.address()?;
    Some(match ep.port() {
        Some(port) => format!("{address}:{port}"),
        None => address.to_string(),
    })
}

/// Map a replication group (redis/valkey) to the unified summary. Different
/// emulators expose the endpoint in different places: floci/kumo populate
/// `ConfigurationEndpoint`, ministack only fills `NodeGroups[0].PrimaryEndpoint`
/// — prefer the configuration endpoint, fall back to the primary endpoint.
fn rg_to_summary(rg: &ReplicationGroup) -> CacheSummary {
    let endpoint = format_endpoint(rg.configuration_endpoint()).or_else(|| {
        rg.node_groups()
            .first()
            .and_then(|ng| format_endpoint(ng.primary_endpoint()))
    });

    // numNodes: count node-group members, falling back to member cluster ids,
    // finally 1 (emulators that expose neither still describe a single node).
    let member_nodes: i32 = rg
        .node_groups()
        .iter()
        .map(|ng| ng.node_group_members().len() as i32)
        .sum();
    let num_nodes = if member_nodes > 0 {
        member_nodes
    } else if !rg.member_clusters().is_empty() {
        rg.member_clusters().len() as i32
    } else {
        1
    };

    CacheSummary {
        id: rg.replication_group_id().unwrap_or_default().to_string(),
        kind: KIND_REPLICATION_GROUP.to_string(),
        // Only ministack echoes the engine on the RG; floci/kumo omit it. RGs are
        // always redis or valkey, so default to redis when it is not reported.
        engine: rg.engine().unwrap_or("redis").to_string(),
        status: rg.status().unwrap_or_default().to_string(),
        node_type: rg.cache_node_type().map(String::from),
        num_nodes,
        endpoint,
    }
}

/// Map a standalone cache cluster (memcached) to the unified summary.
fn cc_to_summary(cc: &CacheCluster) -> CacheSummary {
    let endpoint = format_endpoint(cc.configuration_endpoint()).or_else(|| {
        cc.cache_nodes()
            .first()
            .and_then(|node| format_endpoint(node.endpoint()))
    });

    CacheSummary {
        id: cc.cache_cluster_id().unwrap_or_default().to_string(),
        kind: KIND_CACHE_CLUSTER.to_string(),
        engine: cc.engine().unwrap_or_default().to_string(),
        status: cc.cache_cluster_status().unwrap_or_default().to_string(),
        node_type: cc.cache_node_type().map(String::from),
        num_nodes: cc.num_cache_nodes().unwrap_or(1),
        endpoint,
    }
}

/// True when a cache cluster is a member of a replication group (and therefore
/// already represented by its RG row). ministack's DescribeCacheClusters returns
/// RG member nodes alongside standalone clusters; floci/kumo do not, but the
/// filter is harmless there.
fn belongs_to_replication_group(cc: &CacheCluster) -> bool {
    cc.replication_group_id()
        .map(|id| !id.is_empty())
        .unwrap_or(false)
}

pub async fn list_caches(client: &Client) -> Result<Vec<CacheSummary>, AppError> {
    let rgs = client
        .describe_replication_groups()
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut caches: Vec<CacheSummary> =
        rgs.replication_groups().iter().map(rg_to_summary).collect();

    let ccs = client
        .describe_cache_clusters()
        .show_cache_node_info(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    caches.extend(
        ccs.cache_clusters()
            .iter()
            .filter(|cc| !belongs_to_replication_group(cc))
            .map(cc_to_summary),
    );

    Ok(caches)
}

pub async fn create_cache(client: &Client, req: &CreateCacheRequest) -> Result<(), AppError> {
    match req.engine.as_str() {
        "memcached" => {
            client
                .create_cache_cluster()
                .cache_cluster_id(&req.id)
                .engine(&req.engine)
                .cache_node_type(&req.node_type)
                .num_cache_nodes(req.num_nodes)
                .send()
                .await
                .map_err(map_sdk_err)?;
        }
        // redis / valkey → CreateReplicationGroup (floci-measured contract).
        _ => {
            client
                .create_replication_group()
                .replication_group_id(&req.id)
                .replication_group_description(&req.id)
                .engine(&req.engine)
                .cache_node_type(&req.node_type)
                .num_cache_clusters(req.num_nodes)
                .send()
                .await
                .map_err(map_sdk_err)?;
        }
    }
    Ok(())
}

pub async fn delete_cache(client: &Client, id: &str, kind: &str) -> Result<(), AppError> {
    if kind == KIND_CACHE_CLUSTER {
        client
            .delete_cache_cluster()
            .cache_cluster_id(id)
            .send()
            .await
            .map_err(map_sdk_err)?;
    } else {
        client
            .delete_replication_group()
            .replication_group_id(id)
            .send()
            .await
            .map_err(map_sdk_err)?;
    }
    Ok(())
}

pub async fn get_cache(client: &Client, id: &str, kind: &str) -> Result<CacheSummary, AppError> {
    if kind == KIND_CACHE_CLUSTER {
        let out = client
            .describe_cache_clusters()
            .cache_cluster_id(id)
            .show_cache_node_info(true)
            .send()
            .await
            .map_err(map_sdk_err)?;
        out.cache_clusters()
            .first()
            .map(cc_to_summary)
            .ok_or_else(|| AppError::NotFound(format!("cache cluster not found: {id}")))
    } else {
        let out = client
            .describe_replication_groups()
            .replication_group_id(id)
            .send()
            .await
            .map_err(map_sdk_err)?;
        out.replication_groups()
            .first()
            .map(rg_to_summary)
            .ok_or_else(|| AppError::NotFound(format!("replication group not found: {id}")))
    }
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn elasticache_list_caches(
    profile: ConnectionProfile,
) -> Result<Vec<CacheSummary>, AppError> {
    list_caches(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn elasticache_create_cache(
    profile: ConnectionProfile,
    req: CreateCacheRequest,
) -> Result<(), AppError> {
    create_cache(&make_client(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn elasticache_delete_cache(
    profile: ConnectionProfile,
    id: String,
    kind: String,
) -> Result<(), AppError> {
    delete_cache(&make_client(&profile), &id, &kind).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn elasticache_get_cache(
    profile: ConnectionProfile,
    id: String,
    kind: String,
) -> Result<CacheSummary, AppError> {
    get_cache(&make_client(&profile), &id, &kind).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_elasticache::types::{CacheNode, NodeGroup, NodeGroupMember};

    #[test]
    fn cache_summary_serializes_camel_case() {
        let s = CacheSummary {
            id: "t6-redis".into(),
            kind: KIND_REPLICATION_GROUP.into(),
            engine: "redis".into(),
            status: "available".into(),
            node_type: Some("cache.t3.micro".into()),
            num_nodes: 2,
            endpoint: Some("localhost:6379".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "t6-redis");
        assert_eq!(v["kind"], "replicationGroup");
        assert_eq!(v["engine"], "redis");
        assert_eq!(v["status"], "available");
        assert_eq!(v["nodeType"], "cache.t3.micro");
        assert_eq!(v["numNodes"], 2);
        assert_eq!(v["endpoint"], "localhost:6379");
    }

    #[test]
    fn cache_summary_serializes_null_optionals() {
        let s = CacheSummary {
            id: "t6-mc".into(),
            kind: KIND_CACHE_CLUSTER.into(),
            engine: "memcached".into(),
            status: "creating".into(),
            node_type: None,
            num_nodes: 1,
            endpoint: None,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert!(v["nodeType"].is_null());
        assert!(v["endpoint"].is_null());
    }

    #[test]
    fn create_request_deserializes_camel_case() {
        let req: CreateCacheRequest = serde_json::from_value(serde_json::json!({
            "id": "t6-redis",
            "engine": "redis",
            "nodeType": "cache.t3.micro",
            "numNodes": 1,
        }))
        .unwrap();
        assert_eq!(req.id, "t6-redis");
        assert_eq!(req.engine, "redis");
        assert_eq!(req.node_type, "cache.t3.micro");
        assert_eq!(req.num_nodes, 1);
    }

    #[test]
    fn format_endpoint_joins_address_and_port() {
        let ep = Endpoint::builder().address("host").port(6379).build();
        assert_eq!(format_endpoint(Some(&ep)).as_deref(), Some("host:6379"));

        let no_port = Endpoint::builder().address("host").build();
        assert_eq!(format_endpoint(Some(&no_port)).as_deref(), Some("host"));

        let empty = Endpoint::builder().build();
        assert!(format_endpoint(Some(&empty)).is_none());
        assert!(format_endpoint(None).is_none());
    }

    #[test]
    fn rg_to_summary_prefers_configuration_endpoint() {
        let rg = ReplicationGroup::builder()
            .replication_group_id("rg1")
            .status("available")
            .engine("valkey")
            .cache_node_type("cache.t3.small")
            .configuration_endpoint(Endpoint::builder().address("cfg").port(6379).build())
            .member_clusters("rg1-001")
            .member_clusters("rg1-002")
            .build();
        let s = rg_to_summary(&rg);
        assert_eq!(s.id, "rg1");
        assert_eq!(s.kind, "replicationGroup");
        assert_eq!(s.engine, "valkey");
        assert_eq!(s.node_type.as_deref(), Some("cache.t3.small"));
        assert_eq!(s.num_nodes, 2);
        assert_eq!(s.endpoint.as_deref(), Some("cfg:6379"));
    }

    #[test]
    fn rg_to_summary_falls_back_to_primary_endpoint_and_defaults_engine() {
        // ministack shape: no configuration endpoint, no engine field.
        let ng = NodeGroup::builder()
            .primary_endpoint(Endpoint::builder().address("redis").port(6379).build())
            .node_group_members(NodeGroupMember::builder().build())
            .build();
        let rg = ReplicationGroup::builder()
            .replication_group_id("rg2")
            .status("available")
            .node_groups(ng)
            .build();
        let s = rg_to_summary(&rg);
        assert_eq!(s.engine, "redis"); // defaulted
        assert_eq!(s.endpoint.as_deref(), Some("redis:6379"));
        assert_eq!(s.num_nodes, 1);
    }

    #[test]
    fn cc_to_summary_falls_back_to_cache_node_endpoint() {
        let node = CacheNode::builder()
            .endpoint(Endpoint::builder().address("mc").port(11211).build())
            .build();
        let cc = CacheCluster::builder()
            .cache_cluster_id("mc1")
            .engine("memcached")
            .cache_cluster_status("available")
            .num_cache_nodes(1)
            .cache_nodes(node)
            .build();
        let s = cc_to_summary(&cc);
        assert_eq!(s.id, "mc1");
        assert_eq!(s.kind, "cacheCluster");
        assert_eq!(s.engine, "memcached");
        assert_eq!(s.num_nodes, 1);
        assert_eq!(s.endpoint.as_deref(), Some("mc:11211"));
    }

    #[test]
    fn belongs_to_replication_group_detects_membership() {
        let member = CacheCluster::builder()
            .cache_cluster_id("rg1-001")
            .replication_group_id("rg1")
            .build();
        assert!(belongs_to_replication_group(&member));

        let standalone = CacheCluster::builder()
            .cache_cluster_id("mc1")
            .replication_group_id("")
            .build();
        assert!(!belongs_to_replication_group(&standalone));

        let none = CacheCluster::builder().cache_cluster_id("mc2").build();
        assert!(!belongs_to_replication_group(&none));
    }
}
