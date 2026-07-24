//! Athena integration tests.
//!
//! Requires an emulator that implements the Athena API (e.g. ministack, which
//! returns mock query results, or floci, which runs real DuckDB SQL). Run with:
//!   EMU_ENDPOINT=http://localhost:4830 cargo test -- --ignored
//!
//! Athena writes every query's result set to S3, so the query test first
//! creates the fixed default output bucket (`nlsd-athena-results`). Emulators
//! without Athena support (localstack:3 CE, kumo for workgroups) return an
//! "unsupported operation" error; the tests treat that as a skip and return Ok
//! so the suite stays green everywhere.

use app_lib::commands::athena::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_athena::Client as AthenaClient;
use aws_sdk_s3::Client as S3Client;

const RESULTS_BUCKET: &str = "nlsd-athena-results";

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

fn athena_client() -> AthenaClient {
    AthenaClient::new(&make_sdk_config(&local_profile()))
}

fn s3_client() -> S3Client {
    aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&make_sdk_config(&local_profile()))
            .force_path_style(true)
            .request_checksum_calculation(
                aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired,
            )
            .build(),
    )
}

/// True when the emulator does not implement the called Athena op. Mirrors the
/// frontend `isUnsupportedOperation` detector so both layers skip consistently.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
        || msg.contains("invalidaction")
        || msg.contains("is not valid")
}

#[tokio::test]
#[ignore]
async fn query_start_poll_results() {
    let client = athena_client();

    // Ensure the fixed output bucket exists (the app always sends
    // s3://nlsd-athena-results/); ignore an already-owned bucket.
    let _ = s3_client()
        .create_bucket()
        .bucket(RESULTS_BUCKET)
        .send()
        .await;

    // Probe support via StartQueryExecution; skip on unsupported emulators.
    let started = match start_query(&client, "SELECT 1", None).await {
        Ok(r) => r,
        Err(e) if is_unsupported(&e) => {
            eprintln!("Athena query not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected start_query error: {e}"),
    };
    assert!(!started.execution_id.is_empty());

    // Poll to a terminal state (500ms interval, 30s cap — matches the UI).
    let mut state = String::new();
    for _ in 0..60 {
        let status = get_query_execution(&client, &started.execution_id)
            .await
            .expect("get_query_execution should succeed");
        state = status.state.clone();
        if state == "SUCCEEDED" || state == "FAILED" || state == "CANCELLED" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert_eq!(state, "SUCCEEDED", "SELECT 1 should succeed");

    let results = get_query_results(&client, &started.execution_id)
        .await
        .expect("get_query_results should succeed");
    // R89: at least one result row (values are emulator-dependent — mock on
    // ministack, real "1" on floci — so we only assert the row exists).
    assert!(
        !results.rows.is_empty(),
        "SELECT 1 should return at least one result row"
    );
}

#[tokio::test]
#[ignore]
async fn workgroup_create_list_delete() {
    let client = athena_client();
    let name = "nlsd-t13-it-wg";

    // Probe support; skip on unsupported emulators (kumo, localstack).
    match list_workgroups(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("Athena workgroups not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_workgroups error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_workgroup(&client, name).await;

    create_workgroup(&client, name, Some("integration test"))
        .await
        .expect("create_workgroup should succeed");

    let groups = list_workgroups(&client).await.unwrap();
    assert!(
        groups.iter().any(|w| w.name == name),
        "created workgroup should be listed"
    );

    delete_workgroup(&client, name)
        .await
        .expect("delete_workgroup should succeed");
}

#[tokio::test]
#[ignore]
async fn named_query_create_list_delete() {
    let client = athena_client();
    let name = "nlsd-t13-it-nq";

    // Probe support; skip on unsupported emulators (floci, kumo, localstack).
    match list_named_queries(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("Athena named queries not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_named_queries error: {e}"),
    }

    let created = create_named_query(&client, name, "SELECT 1", Some("default"))
        .await
        .expect("create_named_query should succeed");
    assert!(!created.named_query_id.is_empty());

    let queries = list_named_queries(&client).await.unwrap();
    let found = queries
        .iter()
        .find(|q| q.id == created.named_query_id)
        .expect("created named query should be listed");
    assert_eq!(found.name, name);
    assert_eq!(found.query_string, "SELECT 1");

    delete_named_query(&client, &created.named_query_id)
        .await
        .expect("delete_named_query should succeed");
}
