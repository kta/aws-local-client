//! Requires a live emulator with Step Functions support (ministack / localstack:3
//! / floci / kumo). Run with:
//!   EMU_ENDPOINT=http://localhost:4812 cargo test --test integration_stepfunctions -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `t11_` and cleaned up so the container can be
//! shared with the other service tasks.

use app_lib::commands::stepfunctions::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_sfn::Client;

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

const PASS_ASL: &str = r#"{"StartAt":"P","States":{"P":{"Type":"Pass","End":true}}}"#;

#[tokio::test]
#[ignore]
async fn full_lifecycle_create_execute_history_delete() {
    let client = client();
    let name = "t11_sfn_lifecycle";

    // cleanup from a previous run
    if let Ok(machines) = list_state_machines(&client).await {
        if let Some(m) = machines.iter().find(|m| m.name == name) {
            let _ = delete_state_machine(&client, &m.state_machine_arn).await;
        }
    }

    create_state_machine(&client, name, PASS_ASL).await.unwrap();

    let summary = list_state_machines(&client)
        .await
        .unwrap()
        .into_iter()
        .find(|m| m.name == name)
        .expect("created state machine should be listed");
    let arn = summary.state_machine_arn.clone();

    // describe returns the definition + dummy role.
    let detail = describe_state_machine(&client, &arn).await.unwrap();
    assert_eq!(detail.name, name);
    assert!(detail.definition.contains("Pass"));
    assert!(detail.role_arn.contains("nlsd-dummy"));

    // start an execution and poll it to a terminal state.
    let exec = start_execution(&client, &arn, r#"{"hello":"world"}"#)
        .await
        .unwrap();
    assert!(!exec.execution_arn.is_empty());

    let mut detail_exec = None;
    for _ in 0..30 {
        let d = describe_execution(&client, &exec.execution_arn)
            .await
            .unwrap();
        if d.status != "RUNNING" {
            detail_exec = Some(d);
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    let d = detail_exec.expect("execution should reach a terminal state");
    assert_eq!(d.status, "SUCCEEDED");
    // Pass state propagates input to output (whitespace-insensitive check).
    let out = d.output.unwrap_or_default().replace(' ', "");
    assert!(out.contains("\"hello\":\"world\""), "output was {out}");

    // list_executions surfaces the run.
    let execs = list_executions(&client, &arn).await.unwrap();
    assert!(execs.iter().any(|e| e.execution_arn == exec.execution_arn));

    // history has at least the start + succeeded events.
    let history = get_execution_history(&client, &exec.execution_arn)
        .await
        .unwrap();
    assert!(history.len() >= 2);
    assert!(history.iter().any(|h| h.event_type == "ExecutionStarted"));

    // cleanup
    delete_state_machine(&client, &arn).await.unwrap();
}
