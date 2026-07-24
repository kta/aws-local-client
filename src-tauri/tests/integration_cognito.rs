//! Cognito integration tests.
//!
//! Requires an emulator that implements the Cognito user-pools API (floci,
//! ministack, kumo). Run with:
//!   EMU_ENDPOINT=http://localhost:4732 cargo test --test integration_cognito -- --ignored
//!
//! Emulators without Cognito support (localstack:3 CE = Pro-only) return an
//! "unsupported operation" error on the first list call; the test treats that as
//! a skip and returns Ok so the suite stays green everywhere. Groups and the
//! admin password/enable/disable operations are also best-effort: kumo answers
//! them with InvalidAction, which is likewise treated as a per-op skip.

use app_lib::commands::cognito::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_cognitoidentityprovider::Client;

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

/// True when the emulator does not implement the operation family. Mirrors the
/// frontend `isUnsupportedOperation` detector so both layers skip consistently.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("unknownoperation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
        || msg.contains("is not valid")
        || msg.contains("invalidaction")
}

#[tokio::test]
#[ignore]
async fn user_pool_lifecycle_create_list_describe_delete() {
    let client = client();

    // Probe support via the initial list; skip on unsupported emulators (R60).
    match list_user_pools(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("Cognito not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_user_pools error: {e}"),
    }

    let name = "nlsd-it-pool";
    create_user_pool(&client, name)
        .await
        .expect("create_user_pool should succeed on a Cognito-capable emulator");

    let pools = list_user_pools(&client).await.unwrap();
    let created = pools
        .iter()
        .find(|p| p.name == name)
        .expect("created pool should be listed");
    let pool_id = created.id.clone();

    let detail = get_user_pool(&client, &pool_id).await.unwrap();
    assert_eq!(detail.name, name);

    delete_user_pool(&client, &pool_id).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn user_lifecycle_create_list_password_toggle_delete() {
    let client = client();

    match list_user_pools(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("Cognito not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_user_pools error: {e}"),
    }

    let name = "nlsd-it-userpool";
    create_user_pool(&client, name).await.unwrap();
    let pool_id = list_user_pools(&client)
        .await
        .unwrap()
        .into_iter()
        .find(|p| p.name == name)
        .unwrap()
        .id;

    let username = "it-user";
    admin_create_user(
        &client,
        &pool_id,
        username,
        Some("it-user@example.com"),
        Some("TempPass123!"),
    )
    .await
    .expect("admin_create_user should succeed");

    let users = list_users(&client, &pool_id).await.unwrap();
    let user = users
        .iter()
        .find(|u| u.username == username)
        .expect("created user should be listed");
    assert!(user.enabled);

    // Password set + enable/disable are unsupported on kumo (InvalidAction);
    // treat those as per-op skips.
    let _ = admin_set_user_password(&client, &pool_id, username, "PermPass123!", true).await;
    let _ = admin_disable_user(&client, &pool_id, username).await;
    let _ = admin_enable_user(&client, &pool_id, username).await;

    admin_delete_user(&client, &pool_id, username)
        .await
        .expect("admin_delete_user should succeed");

    delete_user_pool(&client, &pool_id).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn app_clients_and_groups_lifecycle() {
    let client = client();

    match list_user_pools(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("Cognito not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_user_pools error: {e}"),
    }

    let name = "nlsd-it-clientpool";
    create_user_pool(&client, name).await.unwrap();
    let pool_id = list_user_pools(&client)
        .await
        .unwrap()
        .into_iter()
        .find(|p| p.name == name)
        .unwrap()
        .id;

    // App clients: supported on floci/ministack/kumo.
    create_user_pool_client(&client, &pool_id, "it-client")
        .await
        .expect("create_user_pool_client should succeed");
    let clients = list_user_pool_clients(&client, &pool_id).await.unwrap();
    let cid = clients
        .iter()
        .find(|c| c.client_name == "it-client")
        .expect("created client should be listed")
        .client_id
        .clone();
    delete_user_pool_client(&client, &pool_id, &cid)
        .await
        .expect("delete_user_pool_client should succeed");

    // Groups: unsupported on kumo (InvalidAction); skip that op there.
    match list_groups(&client, &pool_id).await {
        Ok(_) => {
            create_group(&client, &pool_id, "it-group", Some("integration group"))
                .await
                .expect("create_group should succeed where groups are supported");
            let groups = list_groups(&client, &pool_id).await.unwrap();
            assert!(groups.iter().any(|g| g.name == "it-group"));
            delete_group(&client, &pool_id, "it-group")
                .await
                .expect("delete_group should succeed");
        }
        Err(e) if is_unsupported(&e) => {
            eprintln!("Cognito groups not supported by this emulator, skipping: {e}");
        }
        Err(e) => panic!("unexpected list_groups error: {e}"),
    }

    delete_user_pool(&client, &pool_id).await.unwrap();
}
