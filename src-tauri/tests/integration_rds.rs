//! RDS integration tests.
//!
//! Requires an emulator that implements the RDS API (e.g. ministack, which mocks
//! RDS and reports instances as immediately `available`). Run with:
//!   EMU_ENDPOINT=http://localhost:4574 cargo test -- --ignored
//!
//! Emulators without RDS support (localstack:3 CE, floci without docker.sock)
//! return an "unsupported operation" error on the very first describe call; the
//! test treats that as a skip and returns Ok so the suite stays green everywhere.

use app_lib::commands::rds::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_rds::Client;

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

/// True when the emulator does not implement the RDS API family. Mirrors the
/// frontend `isUnsupportedOperation` detector so both layers skip consistently.
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
async fn instance_lifecycle_create_list_delete() {
    let client = client();
    let id = "t4-it-instance";

    // Probe support via the initial list; skip on unsupported emulators (R34).
    match list_instances(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("RDS not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_instances error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_instance(&client, id).await;

    create_instance(
        &client,
        &CreateDbInstanceRequest {
            id: id.into(),
            engine: "mysql".into(),
            instance_class: "db.t3.micro".into(),
            master_username: "admin".into(),
            master_password: "password123".into(),
            allocated_storage: 20,
        },
    )
    .await
    .expect("create_instance should succeed on an RDS-capable emulator");

    let instances = list_instances(&client).await.unwrap();
    let created = instances
        .iter()
        .find(|i| i.id == id)
        .expect("created instance should be listed");
    assert_eq!(created.engine, "mysql");
    assert_eq!(created.instance_class, "db.t3.micro");

    delete_instance(&client, id).await.unwrap();
}
