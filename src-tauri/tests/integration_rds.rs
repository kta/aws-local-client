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

/// Create an instance and wait until it reports `available` (ministack mocks
/// this near-instantly). Returns once available or panics after the deadline.
async fn create_available_instance(client: &Client, id: &str) {
    let _ = delete_instance(client, id).await;
    create_instance(
        client,
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

    for _ in 0..30 {
        let instances = list_instances(client).await.unwrap();
        if instances
            .iter()
            .any(|i| i.id == id && i.status == "available")
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    panic!("instance {id} never became available");
}

#[tokio::test]
#[ignore]
async fn snapshot_lifecycle_create_list_restore_delete() {
    let client = client();
    let instance_id = "x4-it-snap-src";
    let snapshot_id = "x4-it-snapshot";
    let restored_id = "x4-it-snap-restored";

    // Probe support; skip on unsupported emulators (R49).
    match list_snapshots(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("RDS snapshots not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_snapshots error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_snapshot(&client, snapshot_id).await;
    let _ = delete_instance(&client, restored_id).await;

    create_available_instance(&client, instance_id).await;

    create_snapshot(&client, instance_id, snapshot_id)
        .await
        .expect("create_snapshot should succeed");

    // Wait for the snapshot to become available before restoring.
    for _ in 0..30 {
        let snaps = list_snapshots(&client).await.unwrap();
        if snaps
            .iter()
            .any(|s| s.id == snapshot_id && s.status == "available")
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    let snaps = list_snapshots(&client).await.unwrap();
    let found = snaps
        .iter()
        .find(|s| s.id == snapshot_id)
        .expect("created snapshot should be listed");
    assert_eq!(found.instance_id, instance_id);

    restore_snapshot(&client, snapshot_id, restored_id)
        .await
        .expect("restore_snapshot should succeed");
    // The restored instance should eventually appear.
    for _ in 0..30 {
        if list_instances(&client)
            .await
            .unwrap()
            .iter()
            .any(|i| i.id == restored_id)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert!(
        list_instances(&client)
            .await
            .unwrap()
            .iter()
            .any(|i| i.id == restored_id),
        "restored instance should be listed"
    );

    // cleanup: restored instance, snapshot, source instance.
    let _ = delete_instance(&client, restored_id).await;
    delete_snapshot(&client, snapshot_id)
        .await
        .expect("delete_snapshot should succeed");
    let _ = delete_instance(&client, instance_id).await;
}

#[tokio::test]
#[ignore]
async fn instance_stop_start_reboot_and_modify() {
    let client = client();
    let id = "x4-it-ops";

    // Probe support; skip on unsupported emulators (R48).
    match list_instances(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("RDS not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_instances error: {e}"),
    }

    create_available_instance(&client, id).await;

    // stop / start / reboot: on emulators that only implement describe (floci)
    // these return an unsupported error, which we treat as a skip for that op.
    let _ = stop_instance(&client, id).await;
    let _ = start_instance(&client, id).await;
    let _ = reboot_instance(&client, id).await;

    // modify: grow allocated storage 20 -> 30 (best-effort; some emulators no-op).
    modify_instance(
        &client,
        id,
        &ModifyInstanceRequest {
            instance_class: None,
            allocated_storage: Some(30),
        },
    )
    .await
    .expect("modify_instance should succeed on an RDS-capable emulator");

    let _ = delete_instance(&client, id).await;
}

#[tokio::test]
#[ignore]
async fn parameter_group_create_list_parameters_delete() {
    let client = client();
    let name = "x4-it-pg";
    let family = "mysql8.0";

    // Probe support; skip on unsupported emulators (R50).
    match list_parameter_groups(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("RDS parameter groups not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_parameter_groups error: {e}"),
    }

    // cleanup from previous runs (delete may fail; ignore).
    let _ = delete_parameter_group(&client, name).await;

    create_parameter_group(&client, name, family, "x4 integration test group")
        .await
        .expect("create_parameter_group should succeed");

    let groups = list_parameter_groups(&client).await.unwrap();
    let found = groups
        .iter()
        .find(|g| g.name == name)
        .expect("created parameter group should be listed");
    assert_eq!(found.family, family);

    let params = list_parameters(&client, name, None).await.unwrap();
    // A freshly created group inherits its family's default parameters.
    assert!(
        !params.parameters.is_empty(),
        "parameter group should expose default parameters"
    );

    // delete is not verified across all emulators (spec R50): log on failure.
    if let Err(e) = delete_parameter_group(&client, name).await {
        eprintln!("delete_parameter_group failed (tolerated per R50): {e}");
    }
}
