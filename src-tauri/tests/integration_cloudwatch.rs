//! Requires a live emulator with CloudWatch Logs + Metrics support
//! (localstack:3 / floci / ministack). Run with:
//!   EMU_ENDPOINT=http://localhost:4800 cargo test --test integration_cloudwatch -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t10_` / `nlsd-t10-` and cleaned up so the
//! container can be shared with the other service tasks. Metrics/Alarms use the
//! legacy Query protocol (spec §2.1-1), driven through the profile-taking
//! functions in `cloudwatch_query`.

use app_lib::commands::cloudwatch::*;
use app_lib::commands::cloudwatch_query::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_cloudwatchlogs::Client;

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

fn logs_client() -> Client {
    Client::new(&make_sdk_config(&local_profile()))
}

#[tokio::test]
#[ignore]
async fn logs_full_lifecycle_group_stream_events_filter() {
    let client = logs_client();
    let group = "t10_cw_logs_group";
    let stream = "t10_stream";

    // cleanup from a previous run
    let _ = delete_log_group(&client, group).await;

    create_log_group(&client, group).await.unwrap();
    assert!(list_log_groups(&client)
        .await
        .unwrap()
        .iter()
        .any(|g| g.name == group));

    // Seed a stream + events directly through the SDK.
    client
        .create_log_stream()
        .log_group_name(group)
        .log_stream_name(stream)
        .send()
        .await
        .unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    client
        .put_log_events()
        .log_group_name(group)
        .log_stream_name(stream)
        .log_events(
            aws_sdk_cloudwatchlogs::types::InputLogEvent::builder()
                .timestamp(now)
                .message("hello-from-integration")
                .build()
                .unwrap(),
        )
        .send()
        .await
        .unwrap();

    let streams = list_log_streams(&client, group).await.unwrap();
    assert!(streams.iter().any(|s| s.name == stream));

    let events = get_log_events(&client, group, stream).await.unwrap();
    assert!(events.iter().any(|e| e.message == "hello-from-integration"));

    let filtered = filter_log_events(&client, group, "hello-from-integration")
        .await
        .unwrap();
    assert!(filtered.iter().any(|e| e.message.contains("hello-from")));

    delete_log_group(&client, group).await.unwrap();
    assert!(!list_log_groups(&client)
        .await
        .unwrap()
        .iter()
        .any(|g| g.name == group));
}

#[tokio::test]
#[ignore]
async fn metrics_and_alarms_via_query_protocol() {
    let profile = local_profile();
    let alarm = "nlsd-t10-alarm";

    // cleanup from a previous run
    let _ = delete_alarms(&profile, &[alarm.to_string()]).await;

    // ListMetrics must succeed (Query protocol) on a supported emulator.
    list_metrics(&profile, Some("AWS/EC2".into()))
        .await
        .expect("ListMetrics via Query protocol should work on this emulator");

    // Create an alarm, confirm it appears, then delete it.
    put_metric_alarm(
        &profile,
        &PutMetricAlarmRequest {
            name: alarm.into(),
            namespace: "NLSD/T10".into(),
            metric_name: "Probe".into(),
            stat: "Average".into(),
            period_sec: 60,
            threshold: 10.0,
            comparison: "GreaterThanThreshold".into(),
        },
    )
    .await
    .unwrap();

    let alarms = describe_alarms(&profile).await.unwrap();
    assert!(
        alarms.iter().any(|a| a.name == alarm),
        "created alarm should be listed"
    );

    delete_alarms(&profile, &[alarm.to_string()]).await.unwrap();
    let after = describe_alarms(&profile).await.unwrap();
    assert!(!after.iter().any(|a| a.name == alarm));
}
