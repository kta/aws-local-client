//! Requires a live emulator with SSM Parameter Store support (e.g. ministack /
//! localstack:3 / floci / kumo).
//! Run with: EMU_ENDPOINT=http://localhost:4650 cargo test -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `/t15_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::ssm::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_ssm::Client;

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

fn put_req(name: &str, value: &str, param_type: &str, overwrite: bool) -> PutParameterRequest {
    PutParameterRequest {
        name: name.into(),
        value: value.into(),
        param_type: param_type.into(),
        overwrite,
        description: None,
    }
}

/// R94: create typed parameters, list with a path-prefix filter, delete.
#[tokio::test]
#[ignore]
async fn create_list_with_prefix_and_delete() {
    let client = client();
    let prefix = "/t15_list";
    let plain = format!("{prefix}/plain");
    let list_p = format!("{prefix}/list");
    let secure = format!("{prefix}/secret");
    let outsider = "/t15_other/x";

    // cleanup from a previous run
    for n in [&plain, &list_p, &secure, &outsider.to_string()] {
        let _ = delete_parameter(&client, n).await;
    }

    put_parameter(&client, &put_req(&plain, "plain-value", "String", true))
        .await
        .unwrap();
    put_parameter(&client, &put_req(&list_p, "a,b,c", "StringList", true))
        .await
        .unwrap();
    put_parameter(&client, &put_req(&secure, "s3cret", "SecureString", true))
        .await
        .unwrap();
    put_parameter(&client, &put_req(outsider, "outsider", "String", true))
        .await
        .unwrap();

    // The prefix filter returns the three prefixed params and excludes the outsider.
    let filtered = list_parameters(&client, Some(prefix)).await.unwrap();
    let names: Vec<&str> = filtered.iter().map(|p| p.name.as_str()).collect();
    assert!(names.contains(&plain.as_str()), "plain missing: {names:?}");
    assert!(names.contains(&list_p.as_str()), "list missing: {names:?}");
    assert!(
        names.contains(&secure.as_str()),
        "secret missing: {names:?}"
    );
    assert!(
        !names.contains(&outsider),
        "prefix filter should exclude the outsider, got {names:?}"
    );

    // Types are reported on the summaries.
    let by_name = |n: &str| filtered.iter().find(|p| p.name == n).unwrap();
    assert_eq!(by_name(&plain).param_type, "String");
    assert_eq!(by_name(&list_p).param_type, "StringList");
    assert_eq!(by_name(&secure).param_type, "SecureString");

    // Delete one and confirm it is gone from the list.
    delete_parameter(&client, &plain).await.unwrap();
    let after = list_parameters(&client, Some(prefix)).await.unwrap();
    assert!(
        !after.iter().any(|p| p.name == plain),
        "deleted parameter still listed"
    );

    // cleanup
    for n in [&list_p, &secure, &outsider.to_string()] {
        let _ = delete_parameter(&client, n).await;
    }
}

/// R95: SecureString decryption, overwrite bumps the version, history lists v1/v2.
#[tokio::test]
#[ignore]
async fn secure_string_decrypt_overwrite_and_history() {
    let client = client();
    let name = "/t15_hist/pw";

    let _ = delete_parameter(&client, name).await;

    // Version 1.
    put_parameter(&client, &put_req(name, "secret-v1", "SecureString", false))
        .await
        .unwrap();

    // WithDecryption returns the plaintext value.
    let v1 = get_parameter(&client, name, true).await.unwrap();
    assert_eq!(v1.param_type, "SecureString");
    assert_eq!(v1.value, "secret-v1");
    assert_eq!(v1.version, 1);

    // Overwrite -> version 2.
    put_parameter(&client, &put_req(name, "secret-v2", "SecureString", true))
        .await
        .unwrap();
    let v2 = get_parameter(&client, name, true).await.unwrap();
    assert_eq!(v2.value, "secret-v2");
    assert_eq!(v2.version, 2);

    // History holds both versions, newest first.
    let history = get_parameter_history(&client, name).await.unwrap();
    let versions: Vec<i64> = history.iter().map(|h| h.version).collect();
    assert!(
        versions.contains(&1) && versions.contains(&2),
        "history should contain v1 and v2, got {versions:?}"
    );
    assert_eq!(history.first().map(|h| h.version), Some(2), "newest first");

    // Deleting a missing parameter surfaces a not-found error.
    delete_parameter(&client, name).await.unwrap();
    assert!(
        get_parameter(&client, name, false).await.is_err(),
        "get after delete should error"
    );
}
