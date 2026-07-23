//! MSK integration tests.
//!
//! Requires an emulator that implements the MSK (Kafka) API. Confirmed working
//! on floci (spawns a real Redpanda broker) and ministack. Run with:
//!   EMU_ENDPOINT=http://localhost:4841 cargo test -- --ignored
//!
//! Emulators without MSK support (localstack:3 CE = Pro feature, kumo = 404)
//! return an "unsupported operation" error on the first list call; the test
//! treats that as a skip and returns Ok so the suite stays green everywhere.

use app_lib::commands::msk::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_kafka::Client;

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

/// True when the emulator does not implement the MSK API family. Mirrors the
/// frontend `isUnsupportedOperation` detector so both layers skip consistently.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("unknownoperation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
        || msg.contains("404")
        || msg.contains("page not found")
}

#[tokio::test]
#[ignore]
async fn cluster_lifecycle_create_describe_brokers_delete() {
    let client = client();
    let name = "t14-it-cluster";

    // Probe support via the initial list; skip on unsupported emulators (R93).
    match list_clusters(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("MSK not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_clusters error: {e}"),
    }

    // cleanup from previous runs
    let existing = list_clusters(&client).await.unwrap();
    for c in existing.iter().filter(|c| c.name == name) {
        let _ = delete_cluster(&client, &c.arn).await;
    }

    create_cluster(&client, name, 1)
        .await
        .expect("create_cluster should succeed on an MSK-capable emulator");

    // Find the created cluster and wait for it to become ACTIVE.
    let mut arn = String::new();
    for _ in 0..30 {
        let clusters = list_clusters(&client).await.unwrap();
        if let Some(c) = clusters.iter().find(|c| c.name == name) {
            arn = c.arn.clone();
            assert_eq!(c.number_of_broker_nodes, Some(1));
            assert_eq!(c.kafka_version.as_deref(), Some("3.6.0"));
            if c.state == "ACTIVE" {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert!(!arn.is_empty(), "created cluster should be listed");

    // describe returns the same summary.
    let detail = describe_cluster(&client, &arn).await.unwrap();
    assert_eq!(detail.name, name);

    // bootstrap brokers: at least the plaintext string must be present.
    let brokers = get_bootstrap_brokers(&client, &arn).await.unwrap();
    assert!(
        brokers.plaintext.is_some(),
        "expected a plaintext bootstrap broker string, got {brokers:?}"
    );

    delete_cluster(&client, &arn)
        .await
        .expect("delete_cluster should succeed");
}
