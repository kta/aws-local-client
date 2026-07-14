//! Requires a live emulator with SNS + SQS support (e.g. ministack / localstack:3).
//! Run with: EMU_ENDPOINT=http://localhost:4574 cargo test --test integration_sns -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t2_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::sns::*;
use app_lib::commands::sqs;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_sns::Client as SnsClient;
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

fn sns_client() -> SnsClient {
    SnsClient::new(&make_sdk_config(&local_profile()))
}

fn sqs_client() -> SqsClient {
    SqsClient::new(&make_sdk_config(&local_profile()))
}

/// Allow SNS to deliver to the SQS queue by attaching a permissive policy.
async fn allow_sns_to_queue(client: &SqsClient, queue_url: &str, queue_arn: &str) {
    let policy = serde_json::json!({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": { "Service": "sns.amazonaws.com" },
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

#[tokio::test]
#[ignore]
async fn topic_subscribe_publish_delivers_to_sqs() {
    let sns = sns_client();
    let sqs_c = sqs_client();
    let topic_name = "t2_sns_topic";
    let queue_name = "t2_sns_queue";

    // ---- cleanup from any previous run ----
    if let Ok(topics) = list_topics(&sns).await {
        if let Some(t) = topics.iter().find(|t| t.name == topic_name) {
            let _ = delete_topic(&sns, &t.topic_arn).await;
        }
    }
    if let Ok(queues) = sqs::list_queues(&sqs_c).await {
        if let Some(q) = queues.iter().find(|q| q.name == queue_name) {
            let _ = sqs::delete_queue(&sqs_c, &q.queue_url).await;
        }
    }

    // ---- create the topic ----
    create_topic(&sns, topic_name, false).await.unwrap();
    let topic = list_topics(&sns)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.name == topic_name)
        .expect("created topic should be listed");
    assert!(!topic.fifo);

    // ---- create the destination SQS queue ----
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
        .expect("created queue should be listed");
    let queue_detail = sqs::get_queue(&sqs_c, &queue.queue_url).await.unwrap();
    let queue_arn = queue_detail.arn.clone();
    assert!(!queue_arn.is_empty());
    allow_sns_to_queue(&sqs_c, &queue.queue_url, &queue_arn).await;

    // ---- subscribe the queue to the topic (envelope delivery, no raw) ----
    subscribe_sqs(&sns, &topic.topic_arn, &queue_arn, None, false)
        .await
        .unwrap();
    let subs = list_subscriptions(&sns, &topic.topic_arn).await.unwrap();
    let sub = subs
        .iter()
        .find(|s| s.endpoint == queue_arn)
        .expect("subscription should be listed");
    assert_eq!(sub.protocol, "sqs");
    assert!(!sub.raw_delivery);

    // ---- publish and confirm real delivery to SQS ----
    let body = "hello-from-t2";
    let message_id = publish(
        &sns,
        &topic.topic_arn,
        &PublishRequest {
            message: body.into(),
            subject: Some("subj-t2".into()),
            attributes: None,
            group_id: None,
            dedup_id: None,
        },
    )
    .await
    .unwrap();
    assert!(!message_id.is_empty(), "publish should return a MessageId");

    // Poll SQS until the SNS envelope arrives; assert the Message field matches.
    let mut delivered = None;
    for _ in 0..15 {
        let received = sqs::receive_messages(&sqs_c, &queue.queue_url)
            .await
            .unwrap();
        if let Some(m) = received.into_iter().next() {
            delivered = Some(m);
            break;
        }
    }
    let delivered = delivered.expect("SNS message should be delivered to SQS");
    let envelope: serde_json::Value =
        serde_json::from_str(&delivered.body).expect("SQS body should be an SNS envelope JSON");
    assert_eq!(
        envelope["Message"].as_str(),
        Some(body),
        "envelope.Message should equal the published message"
    );

    // ---- unsubscribe ----
    unsubscribe(&sns, &sub.subscription_arn).await.unwrap();

    // ---- cleanup ----
    delete_topic(&sns, &topic.topic_arn).await.unwrap();
    sqs::delete_queue(&sqs_c, &queue.queue_url).await.unwrap();
}
