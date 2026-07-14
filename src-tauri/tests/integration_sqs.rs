//! Requires a live emulator with SQS support (e.g. ministack / localstack:3).
//! Run with: EMU_ENDPOINT=http://localhost:4574 cargo test -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t1_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::sqs::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_sqs::Client;

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

#[tokio::test]
#[ignore]
async fn full_lifecycle_create_send_receive_delete_purge_attrs() {
    let client = client();
    let name = "t1_sqs_lifecycle";

    // cleanup from a previous run, if the queue still exists
    if let Ok(queues) = list_queues(&client).await {
        if let Some(q) = queues.iter().find(|q| q.name == name) {
            let _ = delete_queue(&client, &q.queue_url).await;
        }
    }

    create_queue(
        &client,
        &CreateQueueRequest {
            name: name.into(),
            fifo: false,
            visibility_timeout: Some(30),
            retention_period: Some(345600),
            delay_seconds: Some(0),
            redrive_policy: None,
        },
    )
    .await
    .unwrap();

    let summary = list_queues(&client)
        .await
        .unwrap()
        .into_iter()
        .find(|q| q.name == name)
        .expect("created queue should be listed");
    let url = summary.queue_url.clone();
    assert!(!summary.fifo);

    // get_queue returns the ARN and configured attributes.
    let detail = get_queue(&client, &url).await.unwrap();
    assert!(!detail.arn.is_empty());
    assert_eq!(detail.visibility_timeout, 30);

    // send a message and receive it back with a matching body.
    send_message(
        &client,
        &url,
        &SendMessageRequest {
            body: "hello-t1".into(),
            delay_seconds: None,
            attributes: None,
            group_id: None,
            dedup_id: None,
        },
    )
    .await
    .unwrap();

    let mut received = vec![];
    for _ in 0..10 {
        received = receive_messages(&client, &url).await.unwrap();
        if !received.is_empty() {
            break;
        }
    }
    assert_eq!(received.len(), 1, "expected one received message");
    assert_eq!(received[0].body, "hello-t1");

    // delete the received message via its receipt handle.
    delete_message(&client, &url, &received[0].receipt_handle)
        .await
        .unwrap();

    // purge the queue (best-effort; drains any leftovers).
    purge_queue(&client, &url).await.unwrap();

    // set_queue_attributes: change the visibility timeout and confirm it applied.
    set_queue_attributes(
        &client,
        &url,
        &QueueAttributesUpdate {
            visibility_timeout: 45,
            retention_period: 345600,
            delay_seconds: 0,
            redrive_policy: None,
        },
    )
    .await
    .unwrap();
    let detail = get_queue(&client, &url).await.unwrap();
    assert_eq!(detail.visibility_timeout, 45);

    delete_queue(&client, &url).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn tag_lifecycle_list_add_remove() {
    let client = client();
    let name = "x1_sqs_tags";

    if let Ok(queues) = list_queues(&client).await {
        if let Some(q) = queues.iter().find(|q| q.name == name) {
            let _ = delete_queue(&client, &q.queue_url).await;
        }
    }

    create_queue(
        &client,
        &CreateQueueRequest {
            name: name.into(),
            fifo: false,
            visibility_timeout: None,
            retention_period: None,
            delay_seconds: None,
            redrive_policy: None,
        },
    )
    .await
    .unwrap();

    let url = list_queues(&client)
        .await
        .unwrap()
        .into_iter()
        .find(|q| q.name == name)
        .expect("created queue should be listed")
        .queue_url;

    // Newly created queue has no tags.
    let tags = list_queue_tags(&client, &url).await.unwrap();
    assert!(tags.iter().all(|t| t.key != "env"));

    // Add a tag, then confirm it is listed.
    tag_queue(&client, &url, "env", "prod").await.unwrap();
    let tags = list_queue_tags(&client, &url).await.unwrap();
    let env = tags
        .iter()
        .find(|t| t.key == "env")
        .expect("env tag present");
    assert_eq!(env.value, "prod");

    // Remove the tag, then confirm it is gone.
    untag_queue(&client, &url, "env").await.unwrap();
    let tags = list_queue_tags(&client, &url).await.unwrap();
    assert!(tags.iter().all(|t| t.key != "env"));

    delete_queue(&client, &url).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn dlq_sources_lists_or_reports_unsupported() {
    let client = client();
    let dlq_name = "x1_sqs_dlq";
    let src_name = "x1_sqs_dlq_src";

    // cleanup from a previous run
    if let Ok(queues) = list_queues(&client).await {
        for n in [src_name, dlq_name] {
            if let Some(q) = queues.iter().find(|q| q.name == n) {
                let _ = delete_queue(&client, &q.queue_url).await;
            }
        }
    }

    // Create the dead-letter target queue first.
    create_queue(
        &client,
        &CreateQueueRequest {
            name: dlq_name.into(),
            fifo: false,
            visibility_timeout: None,
            retention_period: None,
            delay_seconds: None,
            redrive_policy: None,
        },
    )
    .await
    .unwrap();
    let dlq = get_queue(
        &client,
        &list_queues(&client)
            .await
            .unwrap()
            .into_iter()
            .find(|q| q.name == dlq_name)
            .unwrap()
            .queue_url,
    )
    .await
    .unwrap();

    // Create a source queue whose RedrivePolicy targets the DLQ's ARN.
    let redrive = format!(
        "{{\"deadLetterTargetArn\":\"{}\",\"maxReceiveCount\":3}}",
        dlq.arn
    );
    create_queue(
        &client,
        &CreateQueueRequest {
            name: src_name.into(),
            fifo: false,
            visibility_timeout: None,
            retention_period: None,
            delay_seconds: None,
            redrive_policy: Some(redrive),
        },
    )
    .await
    .unwrap();

    // Query the DLQ's source queues. On emulators without
    // ListDeadLetterSourceQueues (ministack) this returns supported:false;
    // otherwise the source queue must appear.
    let info = list_dlq_sources(&client, &dlq.queue_url).await.unwrap();
    if info.supported {
        assert!(
            info.sources.iter().any(|s| s == src_name),
            "source queue should be listed as a DLQ source, got {:?}",
            info.sources
        );
    } else {
        assert!(info.sources.is_empty());
    }

    // The source queue reports its own RedrivePolicy.
    let src = get_queue(
        &client,
        &list_queues(&client)
            .await
            .unwrap()
            .into_iter()
            .find(|q| q.name == src_name)
            .unwrap()
            .queue_url,
    )
    .await
    .unwrap();
    let src_info = list_dlq_sources(&client, &src.queue_url).await.unwrap();
    assert!(src_info.redrive_policy.is_some());

    delete_queue(&client, &src.queue_url).await.unwrap();
    delete_queue(&client, &dlq.queue_url).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn fifo_create_and_send_or_skip() {
    let client = client();
    let name = "t1_sqs_fifo";

    if let Ok(queues) = list_queues(&client).await {
        if let Some(q) = queues.iter().find(|q| q.name == format!("{name}.fifo")) {
            let _ = delete_queue(&client, &q.queue_url).await;
        }
    }

    // FIFO support is not guaranteed on every emulator; treat any error as an
    // allowed skip per the spec (§3) instead of failing the suite.
    if let Err(e) = create_queue(
        &client,
        &CreateQueueRequest {
            name: name.into(),
            fifo: true,
            visibility_timeout: None,
            retention_period: None,
            delay_seconds: None,
            redrive_policy: None,
        },
    )
    .await
    {
        eprintln!("skipping FIFO test: create failed: {e}");
        return;
    }

    let fifo_name = format!("{name}.fifo");
    let url = match list_queues(&client)
        .await
        .ok()
        .and_then(|qs| qs.into_iter().find(|q| q.name == fifo_name))
    {
        Some(q) => {
            assert!(q.fifo, "queue should be reported as FIFO");
            q.queue_url
        }
        None => {
            eprintln!("skipping FIFO test: queue not listed after create");
            return;
        }
    };

    if let Err(e) = send_message(
        &client,
        &url,
        &SendMessageRequest {
            body: "fifo-t1".into(),
            delay_seconds: None,
            attributes: None,
            group_id: Some("g1".into()),
            dedup_id: Some("d1".into()),
        },
    )
    .await
    {
        eprintln!("skipping FIFO send: {e}");
    }

    let _ = delete_queue(&client, &url).await;
}
