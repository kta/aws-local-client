//! Requires a live emulator with Route 53 support (e.g. ministack / localstack:3).
//! Run with: EMU_ENDPOINT=http://localhost:4862 cargo test --test integration_route53 -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t16` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::route53::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_route53::Client;

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

/// R96/R97: hosted zone create -> list -> record CRUD (CREATE/UPSERT/DELETE) -> delete zone.
#[tokio::test]
#[ignore]
async fn hosted_zone_and_record_lifecycle() {
    let c = client();
    let zone_name = "t16-lifecycle.example.com";

    create_hosted_zone(&c, zone_name).await.unwrap();
    let zone = list_hosted_zones(&c)
        .await
        .unwrap()
        .into_iter()
        .find(|z| z.name.starts_with(zone_name))
        .expect("created zone should be listed");
    assert!(!zone.private_zone);

    // CREATE an A record.
    let rec = RecordSet {
        name: format!("www.{zone_name}."),
        record_type: "A".into(),
        ttl: Some(300),
        values: vec!["1.2.3.4".into()],
    };
    change_record_set(&c, &zone.id, "CREATE", &rec)
        .await
        .unwrap();
    let records = list_record_sets(&c, &zone.id).await.unwrap();
    let found = records
        .iter()
        .find(|r| r.record_type == "A" && r.name.starts_with("www."))
        .expect("A record should be listed");
    assert_eq!(found.values, vec!["1.2.3.4".to_string()]);

    // UPSERT (edit) the same record to a new value.
    let upserted = RecordSet {
        name: format!("www.{zone_name}."),
        record_type: "A".into(),
        ttl: Some(600),
        values: vec!["5.6.7.8".into()],
    };
    change_record_set(&c, &zone.id, "UPSERT", &upserted)
        .await
        .unwrap();
    let records = list_record_sets(&c, &zone.id).await.unwrap();
    let found = records
        .iter()
        .find(|r| r.record_type == "A" && r.name.starts_with("www."))
        .expect("A record should still be listed after UPSERT");
    assert_eq!(found.values, vec!["5.6.7.8".to_string()]);

    // DELETE the record (Route 53 matches on current value).
    change_record_set(&c, &zone.id, "DELETE", &upserted)
        .await
        .unwrap();
    let records = list_record_sets(&c, &zone.id).await.unwrap();
    assert!(
        !records
            .iter()
            .any(|r| r.record_type == "A" && r.name.starts_with("www.")),
        "A record should be gone after DELETE"
    );

    // cleanup
    delete_hosted_zone(&c, &zone.id).await.unwrap();
}

/// R98: health check create -> list -> delete (skipped on emulators without support).
#[tokio::test]
#[ignore]
async fn health_check_lifecycle() {
    let c = client();

    // Some emulators (kumo) do not implement health checks; bail out cleanly.
    let existing = match list_health_checks(&c).await {
        Ok(list) => list,
        Err(_) => return, // unsupported here — covered by the E2E symmetric test
    };
    let before = existing.len();

    create_health_check(
        &c,
        &CreateHealthCheckRequest {
            target: "127.0.0.1".into(),
            port: 80,
            check_type: "TCP".into(),
            resource_path: None,
        },
    )
    .await
    .unwrap();

    let after = list_health_checks(&c).await.unwrap();
    assert!(after.len() > before, "a new health check should be listed");
    let created = after
        .iter()
        .find(|h| h.target == "127.0.0.1" && h.check_type == "TCP")
        .expect("created health check should be listed");
    assert_eq!(created.port, Some(80));

    delete_health_check(&c, &created.id).await.unwrap();
}
