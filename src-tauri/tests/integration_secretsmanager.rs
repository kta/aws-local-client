//! Requires a live emulator with Secrets Manager support (ministack / floci /
//! localstack:3 / kumo). Run with:
//!   EMU_ENDPOINT=http://localhost:4752 cargo test --test integration_secretsmanager -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t5_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::secretsmanager::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_secretsmanager::Client;

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

#[tokio::test]
#[ignore]
async fn full_lifecycle_create_versions_tags_delete() {
    let client = client();
    let name = "t5_secret_lifecycle";

    // Best-effort cleanup from a previous run.
    let _ = delete_secret(&client, name, true, None).await;

    // --- create + describe ---------------------------------------------------
    create_secret(&client, name, "{\"k\":\"v1\"}", Some("t5 probe"))
        .await
        .unwrap();

    let listed = list_secrets(&client).await.unwrap();
    let summary = listed
        .iter()
        .find(|s| s.name == name)
        .expect("created secret should be listed");
    assert_eq!(summary.description.as_deref(), Some("t5 probe"));

    let detail = describe_secret(&client, name).await.unwrap();
    assert_eq!(detail.name, name);
    assert!(!detail.arn.is_empty());

    // --- value get / put a new version --------------------------------------
    let v1 = get_secret_value(&client, name).await.unwrap();
    assert_eq!(v1.secret_string.as_deref(), Some("{\"k\":\"v1\"}"));

    put_secret_value(&client, name, "{\"k\":\"v2\"}")
        .await
        .unwrap();
    let v2 = get_secret_value(&client, name).await.unwrap();
    assert_eq!(v2.secret_string.as_deref(), Some("{\"k\":\"v2\"}"));

    // Versions list (or the DescribeSecret fallback) shows at least AWSCURRENT.
    let versions = list_secret_versions(&client, name).await.unwrap();
    assert!(
        versions
            .iter()
            .any(|v| v.stages.iter().any(|s| s == "AWSCURRENT")),
        "an AWSCURRENT version should be present"
    );

    // --- tags round-trip -----------------------------------------------------
    tag_secret(&client, name, "env", "prod").await.unwrap();
    let tagged = describe_secret(&client, name).await.unwrap();
    assert!(tagged
        .tags
        .iter()
        .any(|t| t.key == "env" && t.value == "prod"));

    untag_secret(&client, name, "env").await.unwrap();
    let untagged = describe_secret(&client, name).await.unwrap();
    assert!(!untagged.tags.iter().any(|t| t.key == "env"));

    // --- delete (force, immediate) ------------------------------------------
    delete_secret(&client, name, true, None).await.unwrap();
}
