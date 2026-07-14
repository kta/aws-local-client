//! Requires a live S3-capable emulator (LocalStack / ministack / floci).
//! Run with: EMU_ENDPOINT=http://localhost:4574 cargo test --test integration_s3 -- --ignored
//!
//! The S3 client is built inside `commands::s3` with path-style addressing, so
//! these tests exercise the real command functions against the emulator.

use app_lib::commands::s3::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};

fn endpoint() -> String {
    std::env::var("EMU_ENDPOINT")
        .or_else(|_| std::env::var("DDB_ENDPOINT"))
        .unwrap_or_else(|_| "http://localhost:8000".into())
}

fn local_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        endpoint_url: endpoint(),
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    }
}

/// Build the same path-style client the commands use.
fn client(p: &ConnectionProfile) -> aws_sdk_s3::Client {
    let config = aws_sdk_s3::config::Builder::from(&make_sdk_config(p))
        .force_path_style(true)
        .build();
    aws_sdk_s3::Client::from_conf(config)
}

#[tokio::test]
#[ignore]
async fn full_lifecycle_bucket_put_list_head_get_delete() {
    let profile = local_profile();
    let c = client(&profile);
    let bucket = "t3-lifecycle";

    // cleanup from previous runs (objects then bucket)
    let _ = delete_object(&c, bucket, "a/b.txt").await;
    let _ = delete_object(&c, bucket, "root.txt").await;
    let _ = delete_bucket(&c, bucket).await;

    create_bucket(&c, bucket, &profile.region).await.unwrap();
    assert!(list_buckets(&c)
        .await
        .unwrap()
        .iter()
        .any(|b| b.name == bucket));

    // Put a nested object and a root object.
    let body = base64_encode("hello world");
    put_object(&c, bucket, "a/b.txt", &body, Some("text/plain".into()))
        .await
        .unwrap();
    put_object(&c, bucket, "root.txt", &base64_encode("root"), None)
        .await
        .unwrap();

    // List at root: delimiter "/" yields prefix "a/" and object "root.txt".
    let page = list_objects(&c, bucket, "", None).await.unwrap();
    assert!(page.prefixes.contains(&"a/".to_string()));
    assert!(page.objects.iter().any(|o| o.key == "root.txt"));
    assert!(!page.objects.iter().any(|o| o.key == "a/b.txt"));

    // List under the "a/" prefix: the nested object appears.
    let page = list_objects(&c, bucket, "a/", None).await.unwrap();
    assert!(page.objects.iter().any(|o| o.key == "a/b.txt"));

    // Head reports content type and size.
    let detail = head_object(&c, bucket, "a/b.txt").await.unwrap();
    assert_eq!(detail.size, "hello world".len() as i64);
    assert_eq!(detail.content_type.as_deref(), Some("text/plain"));

    // Download to a temp path and confirm the bytes round-trip.
    let dir = std::env::temp_dir();
    let dest = dir.join("t3-download.txt");
    let dest_str = dest.to_string_lossy().to_string();
    download_object(&c, bucket, "a/b.txt", &dest_str)
        .await
        .unwrap();
    let downloaded = std::fs::read_to_string(&dest).unwrap();
    assert_eq!(downloaded, "hello world");
    let _ = std::fs::remove_file(&dest);

    // A non-empty bucket cannot be deleted (R29).
    let err = delete_bucket(&c, bucket).await.unwrap_err();
    assert!(
        matches!(err, app_lib::error::AppError::Validation(_))
            || matches!(err, app_lib::error::AppError::Internal(_)),
        "non-empty delete_bucket should error, got: {err:?}"
    );

    // Delete objects, then the bucket succeeds.
    delete_object(&c, bucket, "a/b.txt").await.unwrap();
    delete_object(&c, bucket, "root.txt").await.unwrap();
    delete_bucket(&c, bucket).await.unwrap();
    assert!(!list_buckets(&c)
        .await
        .unwrap()
        .iter()
        .any(|b| b.name == bucket));
}

fn base64_encode(s: &str) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(s.as_bytes())
}
