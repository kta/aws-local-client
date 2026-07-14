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

/// Empty a (possibly versioned) bucket by deleting every object version and
/// delete marker, then delete the bucket. Uses the raw SDK because
/// version-scoped delete is intentionally not exposed as a command.
async fn empty_and_delete_bucket(c: &aws_sdk_s3::Client, bucket: &str) {
    if let Ok(versions) = list_object_versions(c, bucket, "").await {
        for v in versions {
            let _ = c
                .delete_object()
                .bucket(bucket)
                .key(&v.key)
                .version_id(&v.version_id)
                .send()
                .await;
        }
    }
    // Non-versioned residue.
    if let Ok(page) = list_objects(c, bucket, "", None).await {
        for o in page.objects {
            let _ = delete_object(c, bucket, &o.key).await;
        }
    }
    let _ = delete_bucket(c, bucket).await;
}

#[tokio::test]
#[ignore]
async fn versioning_round_trip_list_and_versioned_get() {
    let profile = local_profile();
    let c = client(&profile);
    let bucket = "x3-versioning";

    // A versioned key uses a unique name per run: ministack ignores versionId on
    // delete (R44 bug), so old versions cannot be cleaned and would otherwise
    // accumulate across runs. Scoping to a fresh key keeps the count assertion
    // deterministic regardless of leftovers.
    let key = format!("doc-{}.txt", unique_suffix());

    empty_and_delete_bucket(&c, bucket).await;
    create_bucket(&c, bucket, &profile.region).await.unwrap();

    // Enable versioning and confirm it round-trips via get_bucket_properties.
    set_versioning(&c, bucket, true).await.unwrap();
    let props = get_bucket_properties(&c, bucket).await.unwrap();
    assert_eq!(props.versioning.as_deref(), Some("Enabled"));

    // Two versions of the same key.
    put_object(&c, bucket, &key, &base64_encode("v1"), None)
        .await
        .unwrap();
    put_object(&c, bucket, &key, &base64_encode("v2-longer"), None)
        .await
        .unwrap();

    let mut versions = list_object_versions(&c, bucket, &key).await.unwrap();
    versions.retain(|v| v.key == key && !v.delete_marker);
    assert_eq!(versions.len(), 2, "expected two versions, got {versions:?}");

    // Download the non-latest version and confirm it is the original bytes.
    let old = versions.iter().find(|v| !v.is_latest).unwrap();
    let dest = std::env::temp_dir().join("x3-oldver.txt");
    let dest_str = dest.to_string_lossy().to_string();
    download_object_version(&c, bucket, &key, &old.version_id, &dest_str)
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&dest).unwrap(), "v1");
    let _ = std::fs::remove_file(&dest);

    empty_and_delete_bucket(&c, bucket).await;
}

/// A process-unique suffix (nanos since the epoch) for run-scoped object keys.
fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

#[tokio::test]
#[ignore]
async fn bucket_properties_tagging_cors_and_policy() {
    let profile = local_profile();
    let c = client(&profile);
    let bucket = "x3-props";

    empty_and_delete_bucket(&c, bucket).await;
    create_bucket(&c, bucket, &profile.region).await.unwrap();

    // A freshly created bucket has no tags/CORS/policy: all report as unset.
    let props = get_bucket_properties(&c, bucket).await.unwrap();
    assert!(props.tags.is_empty());
    assert!(props.cors_json.is_none());
    assert!(props.policy_json.is_none());

    // Tagging round-trip.
    put_bucket_tagging(
        &c,
        bucket,
        vec![TagKv {
            key: "env".into(),
            value: "test".into(),
        }],
    )
    .await
    .unwrap();

    // CORS round-trip.
    let cors = r#"[{"allowedMethods":["GET","PUT"],"allowedOrigins":["*"],"allowedHeaders":["*"],"maxAgeSeconds":3000}]"#;
    put_bucket_cors(&c, bucket, cors).await.unwrap();

    // Policy round-trip (public read, scoped to this bucket).
    let policy = format!(
        r#"{{"Version":"2012-10-17","Statement":[{{"Sid":"AllowGet","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::{bucket}/*"}}]}}"#
    );
    put_bucket_policy(&c, bucket, &policy).await.unwrap();

    let props = get_bucket_properties(&c, bucket).await.unwrap();
    assert_eq!(props.tags.len(), 1);
    assert_eq!(props.tags[0].key, "env");
    assert_eq!(props.tags[0].value, "test");
    let cors_json = props.cors_json.expect("cors should be set");
    assert!(cors_json.contains("GET"), "cors json: {cors_json}");
    let policy_json = props.policy_json.expect("policy should be set");
    assert!(
        policy_json.contains("AllowGet"),
        "policy json: {policy_json}"
    );

    empty_and_delete_bucket(&c, bucket).await;
}

#[tokio::test]
#[ignore]
async fn copy_object_and_create_folder() {
    let profile = local_profile();
    let c = client(&profile);
    let bucket = "x3-copy";

    empty_and_delete_bucket(&c, bucket).await;
    create_bucket(&c, bucket, &profile.region).await.unwrap();

    put_object(&c, bucket, "src.txt", &base64_encode("payload"), None)
        .await
        .unwrap();

    // Copy to a new key in the same bucket.
    copy_object(&c, bucket, "src.txt", "dst.txt").await.unwrap();
    let detail = head_object(&c, bucket, "dst.txt").await.unwrap();
    assert_eq!(detail.size, "payload".len() as i64);

    // Create a folder: a "docs/" prefix appears in the root listing.
    create_folder(&c, bucket, "docs").await.unwrap();
    let page = list_objects(&c, bucket, "", None).await.unwrap();
    assert!(
        page.prefixes.contains(&"docs/".to_string()),
        "prefixes: {:?}",
        page.prefixes
    );

    empty_and_delete_bucket(&c, bucket).await;
}

#[tokio::test]
#[ignore]
async fn upload_file_multipart_9mb_round_trips_size() {
    let profile = local_profile();
    let c = client(&profile);
    let bucket = "x3-multipart";

    empty_and_delete_bucket(&c, bucket).await;
    create_bucket(&c, bucket, &profile.region).await.unwrap();

    // 9 MiB temp file -> crosses the 8 MiB threshold into multipart (2 parts).
    let size: usize = 9 * 1024 * 1024;
    let src = std::path::PathBuf::from("/private/tmp").join("x3-upload-9mb.bin");
    std::fs::write(&src, vec![0xabu8; size]).unwrap();
    let src_str = src.to_string_lossy().to_string();

    upload_file(&c, bucket, "big.bin", &src_str).await.unwrap();

    let detail = head_object(&c, bucket, "big.bin").await.unwrap();
    assert_eq!(detail.size, size as i64);

    let _ = std::fs::remove_file(&src);
    empty_and_delete_bucket(&c, bucket).await;
}
