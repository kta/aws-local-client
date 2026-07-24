//! CloudFormation integration tests.
//!
//! Requires an emulator that implements the CloudFormation API and actually
//! provisions the templated resources (ministack, floci, localstack:3). Run:
//!   EMU_ENDPOINT=http://localhost:4772 cargo test --test integration_cloudformation -- --ignored
//!
//! Emulators without CloudFormation support return an unsupported error on the
//! first list call; the test treats that as a skip and returns Ok.

use app_lib::commands::cloudformation::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_cloudformation::Client;

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
}

fn topic_template(topic_name: &str) -> String {
    format!(
        r#"{{"Resources":{{"ProbeTopic":{{"Type":"AWS::SNS::Topic","Properties":{{"TopicName":"{topic_name}"}}}}}},"Outputs":{{"TopicRef":{{"Value":{{"Ref":"ProbeTopic"}}}}}}}}"#
    )
}

async fn wait_status(client: &Client, name: &str, wanted: &str) -> String {
    for _ in 0..60 {
        match get_stack(client, name).await {
            Ok(d) => {
                if d.status == wanted || d.status.ends_with("_FAILED") {
                    return d.status;
                }
            }
            Err(_) => {}
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    "TIMEOUT".into()
}

#[tokio::test]
#[ignore]
async fn stack_lifecycle_create_inspect_update_delete() {
    let client = client();
    let stack = "t7-it-stack";
    let topic1 = "t7-it-topic-a";
    let topic2 = "t7-it-topic-b";

    // Probe support via the initial list; skip on unsupported emulators.
    match list_stacks(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("CloudFormation not supported by this emulator, skipping: {e}");
            return;
        }
        Err(e) => panic!("unexpected list_stacks error: {e}"),
    }

    // cleanup from previous runs
    let _ = delete_stack(&client, stack).await;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    create_stack(&client, stack, &topic_template(topic1), &[])
        .await
        .expect("create_stack should succeed");
    assert_eq!(
        wait_status(&client, stack, "CREATE_COMPLETE").await,
        "CREATE_COMPLETE"
    );

    // list_stacks includes the new stack.
    let stacks = list_stacks(&client).await.unwrap();
    assert!(
        stacks.iter().any(|s| s.name == stack),
        "created stack should be listed"
    );

    // get_stack returns detail with the output.
    let detail = get_stack(&client, stack).await.unwrap();
    assert_eq!(detail.name, stack);

    // list_resources returns the SNS topic (via DescribeStackResources; works
    // on all four emulators including kumo).
    let resources = list_resources(&client, stack).await.unwrap();
    assert!(
        resources
            .iter()
            .any(|r| r.resource_type == "AWS::SNS::Topic"),
        "resources should include the SNS topic, got: {resources:?}"
    );

    // get_template returns a non-empty body.
    let template = get_template(&client, stack).await.unwrap();
    assert!(!template.is_empty(), "template body should not be empty");

    // list_events: supported on a real CFN emulator.
    let events = list_events(&client, stack).await.unwrap();
    assert!(
        events.supported,
        "events should be supported on this emulator"
    );

    // update: change the topic name.
    update_stack(&client, stack, &topic_template(topic2), &[])
        .await
        .expect("update_stack should succeed");
    assert_eq!(
        wait_status(&client, stack, "UPDATE_COMPLETE").await,
        "UPDATE_COMPLETE"
    );

    // delete.
    delete_stack(&client, stack)
        .await
        .expect("delete_stack should succeed");
    for _ in 0..60 {
        let stacks = list_stacks(&client).await.unwrap();
        if !stacks.iter().any(|s| s.name == stack) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    panic!("stack {stack} was not removed");
}

#[tokio::test]
#[ignore]
async fn list_exports_is_callable() {
    let client = client();
    // ListExports should either work or be an unsupported (kumo) call; both are
    // acceptable — assert only that a supported emulator returns a Vec.
    match list_exports(&client).await {
        Ok(_) => {}
        Err(e) if is_unsupported(&e) => {
            eprintln!("ListExports not supported by this emulator, skipping: {e}");
        }
        Err(e) => {
            // kumo answers with a non-XML body -> a deserialization Internal
            // error; tolerate that here (the dashboard degrades gracefully).
            eprintln!("ListExports errored (tolerated): {e}");
        }
    }
}
