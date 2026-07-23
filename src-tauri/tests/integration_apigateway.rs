//! Requires a live emulator with API Gateway (REST v1) support
//! (e.g. ministack / localstack:3 / floci).
//! Run with: EMU_ENDPOINT=http://localhost:4722 cargo test -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t2_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::apigateway::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_apigateway::Client;

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
async fn api_lifecycle_resources_methods_and_stages() {
    let client = client();

    // Fresh API for this run.
    let api = create_api(&client, "t2_apigw_lifecycle", Some("integration test"))
        .await
        .unwrap();
    assert!(!api.id.is_empty());
    assert_eq!(api.name, "t2_apigw_lifecycle");

    // It appears in the listing.
    let apis = list_apis(&client).await.unwrap();
    assert!(apis.iter().any(|a| a.id == api.id));

    // The root resource ("/") is created automatically.
    let resources = get_resources(&client, &api.id).await.unwrap();
    let root = resources
        .iter()
        .find(|r| r.path == "/")
        .expect("root resource should exist");

    // Create a child resource under root.
    let child = create_resource(&client, &api.id, &root.id, "demo")
        .await
        .unwrap();
    assert_eq!(child.path, "/demo");

    // Add a MOCK GET method to the child.
    put_method(
        &client,
        "ap-northeast-1",
        &api.id,
        &child.id,
        "GET",
        &MethodIntegration {
            kind: "mock".into(),
            lambda_arn: None,
        },
    )
    .await
    .unwrap();

    // Deploy to a stage and confirm it is listed.
    let stage = create_deployment(&client, &api.id, "dev").await.unwrap();
    assert_eq!(stage.stage_name, "dev");
    let stages = list_stages(&client, &api.id).await.unwrap();
    assert!(stages.iter().any(|s| s.stage_name == "dev"));

    // Cleanup.
    delete_api(&client, &api.id).await.unwrap();
    let apis = list_apis(&client).await.unwrap();
    assert!(!apis.iter().any(|a| a.id == api.id));
}

#[tokio::test]
#[ignore]
async fn api_key_lifecycle_or_skip() {
    let client = client();

    // API keys are unsupported on some emulators (kumo mis-routes them);
    // treat a create failure as an allowed skip instead of failing the suite.
    let key = match create_api_key(&client, "t2_apigw_key").await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("skipping API key test: create failed: {e}");
            return;
        }
    };
    assert!(!key.id.is_empty());

    let keys = list_api_keys(&client).await.unwrap();
    assert!(keys.iter().any(|k| k.id == key.id));

    delete_api_key(&client, &key.id).await.unwrap();
    let keys = list_api_keys(&client).await.unwrap();
    assert!(!keys.iter().any(|k| k.id == key.id));
}
