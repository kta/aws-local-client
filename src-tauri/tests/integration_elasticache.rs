//! ElastiCache integration tests.
//!
//! Requires an emulator that implements the ElastiCache API (e.g. ministack,
//! which mocks it and reports caches as immediately `available`). Run with:
//!   EMU_ENDPOINT=http://localhost:4762 cargo test --test integration_elasticache -- --ignored
//!
//! Emulators without ElastiCache support (localstack:3 CE = Pro-only) return an
//! "unsupported operation" error on the first describe call; the test treats
//! that as a skip and returns Ok so the suite stays green everywhere.

use app_lib::commands::elasticache::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_elasticache::Client;

fn local_profile() -> ConnectionProfile {
    let endpoint_url = std::env::var("EMU_ENDPOINT")
        .or_else(|_| std::env::var("DDB_ENDPOINT"))
        .unwrap_or_else(|_| "http://localhost:8000".into());
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        endpoint_url,
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    }
}

fn client() -> Client {
    Client::new(&make_sdk_config(&local_profile()))
}

/// True when the emulator does not implement the ElastiCache API family.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("unknownoperation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
}

/// Poll list_caches until `id` is present, or panic after the deadline.
async fn wait_listed(client: &Client, id: &str) -> CacheSummary {
    for _ in 0..30 {
        if let Ok(caches) = list_caches(client).await {
            if let Some(found) = caches.into_iter().find(|c| c.id == id) {
                return found;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    panic!("cache {id} never appeared in the merged list");
}

#[tokio::test]
#[ignore]
async fn redis_replication_group_lifecycle() {
    let client = client();
    let id = "t6-it-redis";

    // Probe support via the initial list; skip on unsupported emulators (R70).
    match list_caches(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("ElastiCache not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_caches error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_cache(&client, id, KIND_REPLICATION_GROUP).await;

    create_cache(
        &client,
        &CreateCacheRequest {
            id: id.into(),
            engine: "redis".into(),
            node_type: "cache.t3.micro".into(),
            num_nodes: 1,
        },
    )
    .await
    .expect("create redis replication group should succeed");

    let found = wait_listed(&client, id).await;
    assert_eq!(found.kind, KIND_REPLICATION_GROUP);
    // Endpoint should be reported once the group is available.
    let detail = get_cache(&client, id, KIND_REPLICATION_GROUP)
        .await
        .unwrap();
    assert_eq!(detail.id, id);

    delete_cache(&client, id, KIND_REPLICATION_GROUP)
        .await
        .expect("delete replication group should succeed");
}

#[tokio::test]
#[ignore]
async fn memcached_cache_cluster_lifecycle() {
    let client = client();
    let id = "t6-it-memcached";

    match list_caches(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("ElastiCache not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_caches error: {e}"),
    }

    let _ = delete_cache(&client, id, KIND_CACHE_CLUSTER).await;

    create_cache(
        &client,
        &CreateCacheRequest {
            id: id.into(),
            engine: "memcached".into(),
            node_type: "cache.t3.micro".into(),
            num_nodes: 1,
        },
    )
    .await
    .expect("create memcached cache cluster should succeed");

    let found = wait_listed(&client, id).await;
    assert_eq!(found.kind, KIND_CACHE_CLUSTER);
    assert_eq!(found.engine, "memcached");

    delete_cache(&client, id, KIND_CACHE_CLUSTER)
        .await
        .expect("delete cache cluster should succeed");
}
