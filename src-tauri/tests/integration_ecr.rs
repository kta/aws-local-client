//! ECR integration tests.
//!
//! Requires an emulator that implements the ECR API (e.g. ministack, or floci
//! started with the docker socket mounted). Run with:
//!   EMU_ENDPOINT=http://localhost:4792 cargo test --test integration_ecr -- --ignored
//!
//! Emulators without ECR support (localstack:3 CE) return an "unsupported
//! operation" / "pro feature" error on the very first describe call; the test
//! treats that as a skip and returns Ok so the suite stays green everywhere.

use app_lib::commands::ecr::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_ecr::Client;

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

fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("unknown operation")
        || msg.contains("unknownoperation")
        || msg.contains("not supported")
        || msg.contains("not yet implemented")
        || msg.contains("pro feature")
        || msg.contains("is not valid")
}

#[tokio::test]
#[ignore]
async fn repository_lifecycle_create_list_images_delete() {
    let client = client();
    let name = "nlsd-it-ecr-repo";

    // Probe support via the initial list; skip on unsupported emulators (R78).
    match list_repositories(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("ECR not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_repositories error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_repository(&client, name, true).await;

    create_repository(&client, name)
        .await
        .expect("create_repository should succeed on an ECR-capable emulator");

    let repos = list_repositories(&client).await.unwrap();
    let created = repos
        .iter()
        .find(|r| r.name == name)
        .expect("created repository should be listed");
    assert!(
        created.uri.contains(name),
        "repository URI should contain the name, got {}",
        created.uri
    );

    // A freshly created repository has no images (push is out of scope, R79).
    let images = list_images(&client, name).await.unwrap();
    assert!(images.is_empty(), "new repository should have no images");

    delete_repository(&client, name, true)
        .await
        .expect("delete_repository should succeed");

    let repos = list_repositories(&client).await.unwrap();
    assert!(
        !repos.iter().any(|r| r.name == name),
        "deleted repository should not be listed"
    );
}
