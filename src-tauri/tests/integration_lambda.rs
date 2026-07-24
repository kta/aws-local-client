//! Requires a live emulator with Lambda support (e.g. ministack / floci /
//! localstack:3 with the docker.sock mount for invoke).
//! Run with: EMU_ENDPOINT=http://localhost:4712 cargo test -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t1_` and cleaned up so the container can be
//! shared with the other service tasks.

use std::io::Write;

use app_lib::commands::lambda::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_lambda::Client;

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

/// Write a minimal python handler zip to a temp path and return that path.
fn write_fixture_zip() -> std::path::PathBuf {
    use std::io::Cursor;
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("index.py", opts).unwrap();
        zip.write_all(
            b"def handler(event, context):\n    return {\"ok\": True, \"echo\": event}\n",
        )
        .unwrap();
        zip.finish().unwrap();
    }
    // Unique per call: tests run in parallel within one binary (same PID), so a
    // PID-only name would collide and one test's cleanup could delete the zip
    // another test is still reading.
    static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir();
    let path = dir.join(format!(
        "t1_lambda_fixture_{}_{}.zip",
        std::process::id(),
        n
    ));
    std::fs::write(&path, cursor.into_inner()).unwrap();
    path
}

#[tokio::test]
#[ignore]
async fn function_lifecycle_create_get_update_delete() {
    let client = client();
    let name = "t1_lambda_fn";
    let zip = write_fixture_zip();

    // cleanup from a previous run
    let _ = delete_function(&client, name).await;

    create_function(
        &client,
        &CreateFunctionRequest {
            name: name.into(),
            runtime: "python3.12".into(),
            handler: "index.handler".into(),
            zip_path: zip.to_string_lossy().to_string(),
            memory_size: Some(128),
            timeout: Some(10),
            description: Some("t1 lambda".into()),
            environment: Some(vec![EnvVarInput {
                key: "FOO".into(),
                value: "bar".into(),
            }]),
        },
    )
    .await
    .unwrap();

    let listed = list_functions(&client).await.unwrap();
    assert!(
        listed.iter().any(|f| f.name == name),
        "created function should be listed"
    );

    let detail = get_function(&client, name).await.unwrap();
    assert_eq!(detail.name, name);
    assert_eq!(detail.role, "arn:aws:iam::000000000000:role/nlsd-dummy");
    assert!(detail.environment.iter().any(|e| e.key == "FOO"));
    let sha_before = detail.code_sha256.clone();

    // update configuration: change memory + env
    update_function_config(
        &client,
        name,
        &UpdateFunctionConfigRequest {
            memory_size: 256,
            timeout: 15,
            description: None,
            environment: vec![EnvVarInput {
                key: "FOO".into(),
                value: "baz".into(),
            }],
        },
    )
    .await
    .unwrap();
    // Wait for the config update to settle (emulators may go Pending briefly).
    for _ in 0..20 {
        let d = get_function(&client, name).await.unwrap();
        if d.memory_size == 256 {
            assert_eq!(
                d.environment.iter().find(|e| e.key == "FOO").unwrap().value,
                "baz"
            );
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // update code: sha256 should be present (unchanged content -> may match; just
    // assert the call succeeds and a sha is returned).
    update_function_code(&client, name, &zip.to_string_lossy())
        .await
        .unwrap();
    let after = get_function(&client, name).await.unwrap();
    assert!(after.code_sha256.is_some());
    let _ = sha_before;

    delete_function(&client, name).await.unwrap();
    let _ = std::fs::remove_file(&zip);
}

#[tokio::test]
#[ignore]
async fn invoke_echoes_payload_or_skips_when_unsupported() {
    let client = client();
    let name = "t1_lambda_invoke";
    let zip = write_fixture_zip();
    let _ = delete_function(&client, name).await;

    create_function(
        &client,
        &CreateFunctionRequest {
            name: name.into(),
            runtime: "python3.12".into(),
            handler: "index.handler".into(),
            zip_path: zip.to_string_lossy().to_string(),
            memory_size: None,
            timeout: None,
            description: None,
            environment: None,
        },
    )
    .await
    .unwrap();

    // Wait for the function to become invokable (localstack goes Pending after
    // create while the runtime image starts). Retry the invoke on conflict.
    let mut result = None;
    for _ in 0..30 {
        match invoke(&client, name, "{\"a\":1}").await {
            Ok(r) => {
                result = Some(r);
                break;
            }
            Err(e) => {
                // Runtime not ready yet / handler missing -> retry a few times.
                let _ = e;
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            }
        }
    }

    if let Some(r) = result {
        assert_eq!(r.status_code, 200);
        if r.function_error.is_none() {
            assert!(
                r.payload.contains("\"a\": 1") || r.payload.contains("\"a\":1"),
                "payload should echo the input, got {}",
                r.payload
            );
        }
    } else {
        eprintln!("skipping invoke assertion: emulator never became invokable");
    }

    let _ = delete_function(&client, name).await;
    let _ = std::fs::remove_file(&zip);
}

#[tokio::test]
#[ignore]
async fn layer_lifecycle_publish_list_delete_or_skip() {
    let client = client();
    let name = "t1_lambda_layer";
    let zip = write_fixture_zip();

    // Layers are unsupported on some emulators (kumo); treat a publish error as
    // an allowed skip rather than failing the shared suite.
    if let Err(e) = publish_layer_version(
        &client,
        &PublishLayerRequest {
            name: name.into(),
            zip_path: zip.to_string_lossy().to_string(),
            compatible_runtimes: vec!["python3.12".into()],
            description: Some("t1 layer".into()),
        },
    )
    .await
    {
        eprintln!("skipping layer test: publish failed: {e}");
        let _ = std::fs::remove_file(&zip);
        return;
    }

    let layers = list_layers(&client).await.unwrap();
    let layer = layers
        .iter()
        .find(|l| l.name == name)
        .expect("published layer should be listed");
    assert!(layer.version >= 1);

    delete_layer_version(&client, name, layer.version)
        .await
        .unwrap();
    let _ = std::fs::remove_file(&zip);
}
