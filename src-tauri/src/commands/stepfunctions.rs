use aws_sdk_sfn::Client;
use aws_smithy_types::date_time::Format;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Dummy IAM role attached to every state machine we create. Local emulators do
/// not enforce IAM, so a fixed placeholder keeps the create UI role-free (same
/// approach as Lambda). Real AWS would require a genuine execution role.
const DUMMY_ROLE_ARN: &str = "arn:aws:iam::000000000000:role/nlsd-dummy";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateMachineSummary {
    pub state_machine_arn: String,
    pub name: String,
    pub r#type: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateMachineDetail {
    pub state_machine_arn: String,
    pub name: String,
    pub status: String,
    pub definition: String,
    pub role_arn: String,
    pub r#type: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRef {
    pub execution_arn: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSummary {
    pub execution_arn: String,
    pub name: String,
    pub status: String,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionDetail {
    pub execution_arn: String,
    pub state_machine_arn: String,
    pub name: String,
    pub status: String,
    pub input: Option<String>,
    pub output: Option<String>,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: i64,
    pub event_type: String,
    pub timestamp: Option<String>,
}

/// Format an SDK timestamp as ISO8601, or None when absent/unformattable.
fn fmt_date(dt: Option<&aws_smithy_types::DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

pub async fn list_state_machines(client: &Client) -> Result<Vec<StateMachineSummary>, AppError> {
    let out = client
        .list_state_machines()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .state_machines()
        .iter()
        .map(|m| StateMachineSummary {
            state_machine_arn: m.state_machine_arn().to_string(),
            name: m.name().to_string(),
            r#type: m.r#type().as_str().to_string(),
            created_at: fmt_date(Some(m.creation_date())),
        })
        .collect())
}

pub async fn create_state_machine(
    client: &Client,
    name: &str,
    definition: &str,
) -> Result<(), AppError> {
    client
        .create_state_machine()
        .name(name)
        .definition(definition)
        .role_arn(DUMMY_ROLE_ARN)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn update_state_machine(
    client: &Client,
    arn: &str,
    definition: &str,
) -> Result<(), AppError> {
    client
        .update_state_machine()
        .state_machine_arn(arn)
        .definition(definition)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_state_machine(client: &Client, arn: &str) -> Result<(), AppError> {
    client
        .delete_state_machine()
        .state_machine_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn describe_state_machine(
    client: &Client,
    arn: &str,
) -> Result<StateMachineDetail, AppError> {
    let out = client
        .describe_state_machine()
        .state_machine_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(StateMachineDetail {
        state_machine_arn: out.state_machine_arn().to_string(),
        name: out.name().to_string(),
        status: out
            .status()
            .map(|s| s.as_str().to_string())
            .unwrap_or_default(),
        definition: out.definition().to_string(),
        role_arn: out.role_arn().to_string(),
        r#type: out.r#type().as_str().to_string(),
        created_at: fmt_date(Some(out.creation_date())),
    })
}

pub async fn start_execution(
    client: &Client,
    arn: &str,
    input: &str,
) -> Result<ExecutionRef, AppError> {
    // Step Functions requires valid JSON input; default to an empty object.
    let input = if input.trim().is_empty() { "{}" } else { input };
    let out = client
        .start_execution()
        .state_machine_arn(arn)
        .input(input)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ExecutionRef {
        execution_arn: out.execution_arn().to_string(),
    })
}

pub async fn list_executions(
    client: &Client,
    arn: &str,
) -> Result<Vec<ExecutionSummary>, AppError> {
    let out = client
        .list_executions()
        .state_machine_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .executions()
        .iter()
        .map(|e| ExecutionSummary {
            execution_arn: e.execution_arn().to_string(),
            name: e.name().to_string(),
            status: e.status().as_str().to_string(),
            started_at: fmt_date(Some(e.start_date())),
            stopped_at: fmt_date(e.stop_date()),
        })
        .collect())
}

pub async fn describe_execution(
    client: &Client,
    execution_arn: &str,
) -> Result<ExecutionDetail, AppError> {
    let out = client
        .describe_execution()
        .execution_arn(execution_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ExecutionDetail {
        execution_arn: out.execution_arn().to_string(),
        state_machine_arn: out.state_machine_arn().to_string(),
        name: out.name().map(str::to_string).unwrap_or_default(),
        status: out.status().as_str().to_string(),
        input: out.input().map(str::to_string),
        output: out.output().map(str::to_string),
        started_at: fmt_date(Some(out.start_date())),
        stopped_at: fmt_date(out.stop_date()),
    })
}

pub async fn get_execution_history(
    client: &Client,
    execution_arn: &str,
) -> Result<Vec<HistoryEvent>, AppError> {
    let out = client
        .get_execution_history()
        .execution_arn(execution_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .events()
        .iter()
        .map(|ev| HistoryEvent {
            id: ev.id(),
            event_type: ev.r#type().as_str().to_string(),
            timestamp: fmt_date(Some(ev.timestamp())),
        })
        .collect())
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_list_state_machines(
    profile: ConnectionProfile,
) -> Result<Vec<StateMachineSummary>, AppError> {
    list_state_machines(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_create_state_machine(
    profile: ConnectionProfile,
    name: String,
    definition: String,
) -> Result<(), AppError> {
    create_state_machine(&client_for(&profile), &name, &definition).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_update_state_machine(
    profile: ConnectionProfile,
    arn: String,
    definition: String,
) -> Result<(), AppError> {
    update_state_machine(&client_for(&profile), &arn, &definition).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_delete_state_machine(
    profile: ConnectionProfile,
    arn: String,
) -> Result<(), AppError> {
    delete_state_machine(&client_for(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_describe_state_machine(
    profile: ConnectionProfile,
    arn: String,
) -> Result<StateMachineDetail, AppError> {
    describe_state_machine(&client_for(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_start_execution(
    profile: ConnectionProfile,
    arn: String,
    input: String,
) -> Result<ExecutionRef, AppError> {
    start_execution(&client_for(&profile), &arn, &input).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_list_executions(
    profile: ConnectionProfile,
    arn: String,
) -> Result<Vec<ExecutionSummary>, AppError> {
    list_executions(&client_for(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_describe_execution(
    profile: ConnectionProfile,
    execution_arn: String,
) -> Result<ExecutionDetail, AppError> {
    describe_execution(&client_for(&profile), &execution_arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sfn_get_execution_history(
    profile: ConnectionProfile,
    execution_arn: String,
) -> Result<Vec<HistoryEvent>, AppError> {
    get_execution_history(&client_for(&profile), &execution_arn).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn state_machine_summary_serializes_camel_case() {
        let s = StateMachineSummary {
            state_machine_arn: "arn:aws:states:...:stateMachine:sm".into(),
            name: "sm".into(),
            r#type: "STANDARD".into(),
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["stateMachineArn"], "arn:aws:states:...:stateMachine:sm");
        assert_eq!(v["name"], "sm");
        assert_eq!(v["type"], "STANDARD");
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn state_machine_detail_serializes_camel_case() {
        let d = StateMachineDetail {
            state_machine_arn: "arn:sm".into(),
            name: "sm".into(),
            status: "ACTIVE".into(),
            definition: "{\"StartAt\":\"P\"}".into(),
            role_arn: DUMMY_ROLE_ARN.into(),
            r#type: "STANDARD".into(),
            created_at: None,
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["stateMachineArn"], "arn:sm");
        assert_eq!(v["status"], "ACTIVE");
        assert_eq!(v["definition"], "{\"StartAt\":\"P\"}");
        assert_eq!(v["roleArn"], DUMMY_ROLE_ARN);
        assert_eq!(v["type"], "STANDARD");
        assert_eq!(v["createdAt"], Value::Null);
    }

    #[test]
    fn execution_ref_serializes_camel_case() {
        let r = ExecutionRef {
            execution_arn: "arn:exec".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["executionArn"], "arn:exec");
    }

    #[test]
    fn execution_summary_serializes_camel_case() {
        let s = ExecutionSummary {
            execution_arn: "arn:exec".into(),
            name: "e1".into(),
            status: "SUCCEEDED".into(),
            started_at: Some("2026-07-22T00:00:00Z".into()),
            stopped_at: None,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["executionArn"], "arn:exec");
        assert_eq!(v["name"], "e1");
        assert_eq!(v["status"], "SUCCEEDED");
        assert_eq!(v["startedAt"], "2026-07-22T00:00:00Z");
        assert_eq!(v["stoppedAt"], Value::Null);
    }

    #[test]
    fn execution_detail_serializes_camel_case() {
        let d = ExecutionDetail {
            execution_arn: "arn:exec".into(),
            state_machine_arn: "arn:sm".into(),
            name: "e1".into(),
            status: "SUCCEEDED".into(),
            input: Some("{\"hello\":\"world\"}".into()),
            output: Some("{\"hello\":\"world\"}".into()),
            started_at: Some("2026-07-22T00:00:00Z".into()),
            stopped_at: Some("2026-07-22T00:00:01Z".into()),
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["executionArn"], "arn:exec");
        assert_eq!(v["stateMachineArn"], "arn:sm");
        assert_eq!(v["input"], "{\"hello\":\"world\"}");
        assert_eq!(v["output"], "{\"hello\":\"world\"}");
        assert_eq!(v["startedAt"], "2026-07-22T00:00:00Z");
        assert_eq!(v["stoppedAt"], "2026-07-22T00:00:01Z");
    }

    #[test]
    fn history_event_serializes_camel_case() {
        let e = HistoryEvent {
            id: 1,
            event_type: "ExecutionStarted".into(),
            timestamp: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["id"], 1);
        assert_eq!(v["eventType"], "ExecutionStarted");
        assert_eq!(v["timestamp"], "2026-07-22T00:00:00Z");
    }
}
