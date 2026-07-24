//! OpenSearch integration tests.
//!
//! Requires an emulator that implements the OpenSearch API (e.g. ministack,
//! which mocks domains). Run with:
//!   EMU_ENDPOINT=http://localhost:4820 cargo test -- --ignored
//!
//! Emulators without OpenSearch support (kumo) return an "unsupported operation"
//! error on the very first list call; the test treats that as a skip and returns
//! Ok so the suite stays green everywhere.

use app_lib::commands::opensearch::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_opensearch::Client;

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

/// True when the emulator does not implement the OpenSearch API family. Mirrors
/// the frontend `isUnsupportedOperation` detector so both layers skip
/// consistently.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("unknownoperation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
}

#[tokio::test]
#[ignore]
async fn domain_lifecycle_create_list_get_delete() {
    let client = client();
    let name = "t12-it-domain";

    // Probe support via the initial list; skip on unsupported emulators (R88).
    match list_domains(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("OpenSearch not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_domains error: {e}"),
    }

    // cleanup from previous runs (delete may fail; ignore).
    let _ = delete_domain(&client, name).await;

    create_domain(&client, name)
        .await
        .expect("create_domain should succeed on an OpenSearch-capable emulator");

    let domains = list_domains(&client).await.unwrap();
    let found = domains
        .iter()
        .find(|d| d.name == name)
        .expect("created domain should be listed");
    // The status flags are emulator-dependent, but the row must round-trip.
    assert_eq!(found.name, name);

    let detail = get_domain(&client, name)
        .await
        .expect("get_domain should succeed for the created domain");
    assert_eq!(detail.name, name);

    delete_domain(&client, name)
        .await
        .expect("delete_domain should succeed");
}
