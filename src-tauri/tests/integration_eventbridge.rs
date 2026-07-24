//! Requires a live emulator with EventBridge + SQS support
//! (e.g. ministack / localstack:3 / floci / kumo).
//! Run with:
//!   EMU_ENDPOINT=http://localhost:4566 cargo test --test integration_eventbridge -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t4_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::eventbridge::*;
use app_lib::commands::sqs;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_eventbridge::Client as EbClient;
use aws_sdk_sqs::types::QueueAttributeName;
use aws_sdk_sqs::Client as SqsClient;

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

fn eb_client() -> EbClient {
    EbClient::new(&make_sdk_config(&local_profile()))
}

fn sqs_client() -> SqsClient {
    SqsClient::new(&make_sdk_config(&local_profile()))
}

/// Allow EventBridge to deliver to the SQS queue via a permissive policy.
async fn allow_events_to_queue(client: &SqsClient, queue_url: &str, queue_arn: &str) {
    let policy = serde_json::json!({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": { "Service": "events.amazonaws.com" },
            "Action": "sqs:SendMessage",
            "Resource": queue_arn
        }]
    })
    .to_string();
    client
        .set_queue_attributes()
        .queue_url(queue_url)
        .attributes(QueueAttributeName::Policy, policy)
        .send()
        .await
        .expect("set queue policy");
}

/// R63: bus create / list / delete round-trip.
#[tokio::test]
#[ignore]
async fn bus_create_list_delete_round_trip() {
    let eb = eb_client();
    let bus_name = "t4_eb_bus";

    // cleanup from any previous run
    let _ = delete_bus(&eb, bus_name).await;

    create_bus(&eb, bus_name).await.unwrap();
    let buses = list_buses(&eb).await.unwrap();
    assert!(
        buses.iter().any(|b| b.name == bus_name),
        "created bus should be listed"
    );
    assert!(
        buses.iter().any(|b| b.name == "default"),
        "the built-in default bus should always be present"
    );

    delete_bus(&eb, bus_name).await.unwrap();
    let after = list_buses(&eb).await.unwrap();
    assert!(
        !after.iter().any(|b| b.name == bus_name),
        "bus should be gone after delete"
    );
}

/// R64: rule create / enable-disable / target attach-remove / delete round-trip.
#[tokio::test]
#[ignore]
async fn rule_and_target_round_trip() {
    let eb = eb_client();
    let sqs_c = sqs_client();
    let rule_name = "t4_eb_rule";
    let queue_name = "t4_eb_rule_queue";

    // cleanup
    let _ = delete_rule(&eb, rule_name, "default").await;
    if let Ok(queues) = sqs::list_queues(&sqs_c).await {
        if let Some(q) = queues.iter().find(|q| q.name == queue_name) {
            let _ = sqs::delete_queue(&sqs_c, &q.queue_url).await;
        }
    }

    // create the rule with an event pattern
    put_rule(
        &eb,
        &PutRuleRequest {
            name: rule_name.into(),
            bus: "default".into(),
            schedule_expression: None,
            event_pattern: Some(r#"{"source":["nlsd.it"]}"#.into()),
            description: Some("t4 integration".into()),
            enabled: true,
        },
    )
    .await
    .unwrap();
    let rules = list_rules(&eb, "default").await.unwrap();
    let rule = rules
        .iter()
        .find(|r| r.name == rule_name)
        .expect("created rule should be listed");
    assert_eq!(rule.state, "ENABLED");

    // disable then re-enable
    disable_rule(&eb, rule_name, "default").await.unwrap();
    let disabled = list_rules(&eb, "default").await.unwrap();
    assert_eq!(
        disabled.iter().find(|r| r.name == rule_name).unwrap().state,
        "DISABLED"
    );
    enable_rule(&eb, rule_name, "default").await.unwrap();
    let enabled = list_rules(&eb, "default").await.unwrap();
    assert_eq!(
        enabled.iter().find(|r| r.name == rule_name).unwrap().state,
        "ENABLED"
    );

    // create a queue target and attach it
    sqs::create_queue(
        &sqs_c,
        &sqs::CreateQueueRequest {
            name: queue_name.into(),
            fifo: false,
            visibility_timeout: Some(30),
            retention_period: Some(345600),
            delay_seconds: Some(0),
            redrive_policy: None,
        },
    )
    .await
    .unwrap();
    let queue = sqs::list_queues(&sqs_c)
        .await
        .unwrap()
        .into_iter()
        .find(|q| q.name == queue_name)
        .expect("queue should be listed");
    let queue_arn = sqs::get_queue(&sqs_c, &queue.queue_url).await.unwrap().arn;

    put_target(&eb, rule_name, "default", "t1", &queue_arn)
        .await
        .unwrap();
    let targets = list_targets(&eb, rule_name, "default").await.unwrap();
    assert!(
        targets.iter().any(|t| t.arn == queue_arn),
        "target ARN should be attached"
    );

    remove_target(&eb, rule_name, "default", "t1")
        .await
        .unwrap();
    let after_targets = list_targets(&eb, rule_name, "default").await.unwrap();
    assert!(
        !after_targets.iter().any(|t| t.arn == queue_arn),
        "target should be gone after remove"
    );

    // cleanup
    delete_rule(&eb, rule_name, "default").await.unwrap();
    sqs::delete_queue(&sqs_c, &queue.queue_url).await.unwrap();
}

/// R65: PutEvents through a matching rule is really delivered to the SQS target.
#[tokio::test]
#[ignore]
async fn put_events_delivers_to_sqs_target() {
    let eb = eb_client();
    let sqs_c = sqs_client();
    let rule_name = "t4_eb_delivery_rule";
    let queue_name = "t4_eb_delivery_queue";

    // cleanup
    let _ = delete_rule(&eb, rule_name, "default").await;
    if let Ok(queues) = sqs::list_queues(&sqs_c).await {
        if let Some(q) = queues.iter().find(|q| q.name == queue_name) {
            let _ = sqs::delete_queue(&sqs_c, &q.queue_url).await;
        }
    }

    // destination queue + delivery policy
    sqs::create_queue(
        &sqs_c,
        &sqs::CreateQueueRequest {
            name: queue_name.into(),
            fifo: false,
            visibility_timeout: Some(0),
            retention_period: Some(345600),
            delay_seconds: Some(0),
            redrive_policy: None,
        },
    )
    .await
    .unwrap();
    let queue = sqs::list_queues(&sqs_c)
        .await
        .unwrap()
        .into_iter()
        .find(|q| q.name == queue_name)
        .expect("queue should be listed");
    let queue_arn = sqs::get_queue(&sqs_c, &queue.queue_url).await.unwrap().arn;
    allow_events_to_queue(&sqs_c, &queue.queue_url, &queue_arn).await;

    // rule + target
    put_rule(
        &eb,
        &PutRuleRequest {
            name: rule_name.into(),
            bus: "default".into(),
            schedule_expression: None,
            event_pattern: Some(r#"{"source":["nlsd.it"]}"#.into()),
            description: None,
            enabled: true,
        },
    )
    .await
    .unwrap();
    put_target(&eb, rule_name, "default", "t1", &queue_arn)
        .await
        .unwrap();

    // send the event and confirm real delivery to SQS
    let marker = "it-marker-t4";
    let detail = format!(r#"{{"marker":"{marker}"}}"#);
    let result = put_events(&eb, "default", "nlsd.it", "itEvent", &detail)
        .await
        .unwrap();
    assert_eq!(
        result.failed_count, 0,
        "PutEvents should report no failures"
    );

    let mut delivered = None;
    for _ in 0..15 {
        let received = sqs::receive_messages(&sqs_c, &queue.queue_url)
            .await
            .unwrap();
        if let Some(m) = received.into_iter().find(|m| m.body.contains(marker)) {
            delivered = Some(m);
            break;
        }
    }
    let delivered = delivered.expect("event should be delivered to the SQS target");
    assert!(
        delivered.body.contains(marker),
        "delivered envelope should carry the event detail"
    );

    // cleanup
    let _ = remove_target(&eb, rule_name, "default", "t1").await;
    delete_rule(&eb, rule_name, "default").await.unwrap();
    sqs::delete_queue(&sqs_c, &queue.queue_url).await.unwrap();
}
