use aws_sdk_cloudformation::types::{Capability, Parameter, StackStatus};
use aws_sdk_cloudformation::Client;
use aws_smithy_types::date_time::Format;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnStackSummary {
    pub name: String,
    pub status: String,
    pub status_reason: Option<String>,
    pub created_at: Option<String>,
}

/// A stack parameter. Used both as create/update input and detail output, so it
/// derives both Deserialize and Serialize.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnParameter {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnOutput {
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub export_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnStackDetail {
    pub name: String,
    pub status: String,
    pub status_reason: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub outputs: Vec<CfnOutput>,
    pub parameters: Vec<CfnParameter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnResource {
    pub logical_id: String,
    pub physical_id: Option<String>,
    pub resource_type: String,
    pub status: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnStackEvent {
    pub event_id: String,
    pub logical_id: Option<String>,
    pub resource_type: Option<String>,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub timestamp: Option<String>,
}

/// Events wrapped with a support flag: kumo answers DescribeStackEvents with a
/// non-XML body the SDK cannot deserialize, so the events tab degrades to a
/// notice instead of an error (mirrors the SQS DlqSourceInfo pattern).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnEventsResult {
    pub events: Vec<CfnStackEvent>,
    pub supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfnExport {
    pub name: String,
    pub value: String,
    pub exporting_stack_id: Option<String>,
}

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

/// Capabilities acknowledged for every create/update so templates that declare
/// IAM resources or use transforms are accepted without a separate UI toggle.
fn all_capabilities() -> Vec<Capability> {
    vec![
        Capability::CapabilityIam,
        Capability::CapabilityNamedIam,
        Capability::CapabilityAutoExpand,
    ]
}

fn to_parameters(params: &[CfnParameter]) -> Vec<Parameter> {
    params
        .iter()
        .map(|p| {
            Parameter::builder()
                .parameter_key(&p.key)
                .parameter_value(&p.value)
                .build()
        })
        .collect()
}

pub async fn list_stacks(client: &Client) -> Result<Vec<CfnStackSummary>, AppError> {
    let out = client.list_stacks().send().await.map_err(map_sdk_err)?;
    Ok(out
        .stack_summaries()
        .iter()
        // A deleted stack lingers in ListStacks; the console hides it.
        .filter(|s| s.stack_status() != Some(&StackStatus::DeleteComplete))
        .map(|s| CfnStackSummary {
            name: s.stack_name().unwrap_or_default().to_string(),
            status: s
                .stack_status()
                .map(|st| st.as_str().to_string())
                .unwrap_or_default(),
            status_reason: s.stack_status_reason().map(String::from),
            created_at: s
                .creation_time()
                .and_then(|dt| dt.fmt(Format::DateTime).ok()),
        })
        .collect())
}

pub async fn create_stack(
    client: &Client,
    name: &str,
    template_body: &str,
    parameters: &[CfnParameter],
) -> Result<(), AppError> {
    client
        .create_stack()
        .stack_name(name)
        .template_body(template_body)
        .set_parameters(Some(to_parameters(parameters)))
        .set_capabilities(Some(all_capabilities()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn update_stack(
    client: &Client,
    name: &str,
    template_body: &str,
    parameters: &[CfnParameter],
) -> Result<(), AppError> {
    client
        .update_stack()
        .stack_name(name)
        .template_body(template_body)
        .set_parameters(Some(to_parameters(parameters)))
        .set_capabilities(Some(all_capabilities()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_stack(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_stack()
        .stack_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_stack(client: &Client, name: &str) -> Result<CfnStackDetail, AppError> {
    let out = client
        .describe_stacks()
        .stack_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let stack = out
        .stacks()
        .first()
        .ok_or_else(|| AppError::NotFound(format!("stack {name} not found")))?;
    let outputs = stack
        .outputs()
        .iter()
        .map(|o| CfnOutput {
            key: o.output_key().unwrap_or_default().to_string(),
            value: o.output_value().unwrap_or_default().to_string(),
            description: o.description().map(String::from),
            export_name: o.export_name().map(String::from),
        })
        .collect();
    let parameters = stack
        .parameters()
        .iter()
        .map(|p| CfnParameter {
            key: p.parameter_key().unwrap_or_default().to_string(),
            value: p.parameter_value().unwrap_or_default().to_string(),
        })
        .collect();
    Ok(CfnStackDetail {
        name: stack.stack_name().unwrap_or_default().to_string(),
        status: stack
            .stack_status()
            .map(|st| st.as_str().to_string())
            .unwrap_or_default(),
        status_reason: stack.stack_status_reason().map(String::from),
        created_at: stack
            .creation_time()
            .and_then(|dt| dt.fmt(Format::DateTime).ok()),
        updated_at: stack
            .last_updated_time()
            .and_then(|dt| dt.fmt(Format::DateTime).ok()),
        outputs,
        parameters,
    })
}

/// List resources via DescribeStackResources rather than ListStackResources:
/// both return the same fields, but kumo answers ListStackResources with a
/// non-XML body the SDK cannot parse, while DescribeStackResources works on all
/// four emulators (measured 2026-07-22).
pub async fn list_resources(client: &Client, name: &str) -> Result<Vec<CfnResource>, AppError> {
    let out = client
        .describe_stack_resources()
        .stack_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .stack_resources()
        .iter()
        .map(|r| CfnResource {
            logical_id: r.logical_resource_id().unwrap_or_default().to_string(),
            physical_id: r.physical_resource_id().map(String::from),
            resource_type: r.resource_type().unwrap_or_default().to_string(),
            status: r
                .resource_status()
                .map(|s| s.as_str().to_string())
                .unwrap_or_default(),
            timestamp: r.timestamp().and_then(|dt| dt.fmt(Format::DateTime).ok()),
        })
        .collect())
}

pub async fn list_events(client: &Client, name: &str) -> Result<CfnEventsResult, AppError> {
    match client.describe_stack_events().stack_name(name).send().await {
        Ok(out) => {
            let events = out
                .stack_events()
                .iter()
                .map(|e| CfnStackEvent {
                    event_id: e.event_id().unwrap_or_default().to_string(),
                    logical_id: e.logical_resource_id().map(String::from),
                    resource_type: e.resource_type().map(String::from),
                    status: e.resource_status().map(|s| s.as_str().to_string()),
                    reason: e.resource_status_reason().map(String::from),
                    timestamp: e.timestamp().and_then(|dt| dt.fmt(Format::DateTime).ok()),
                })
                .collect();
            Ok(CfnEventsResult {
                events,
                supported: true,
            })
        }
        // kumo returns a non-XML body the SDK cannot deserialize; treat any
        // failure here as "events unavailable on this emulator" so the tab
        // shows a notice instead of a hard error.
        Err(_) => Ok(CfnEventsResult {
            events: vec![],
            supported: false,
        }),
    }
}

pub async fn get_template(client: &Client, name: &str) -> Result<String, AppError> {
    let out = client
        .get_template()
        .stack_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.template_body().unwrap_or_default().to_string())
}

pub async fn list_exports(client: &Client) -> Result<Vec<CfnExport>, AppError> {
    let out = client.list_exports().send().await.map_err(map_sdk_err)?;
    Ok(out
        .exports()
        .iter()
        .map(|e| CfnExport {
            name: e.name().unwrap_or_default().to_string(),
            value: e.value().unwrap_or_default().to_string(),
            exporting_stack_id: e.exporting_stack_id().map(String::from),
        })
        .collect())
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_list_stacks(profile: ConnectionProfile) -> Result<Vec<CfnStackSummary>, AppError> {
    list_stacks(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_create_stack(
    profile: ConnectionProfile,
    name: String,
    template_body: String,
    parameters: Vec<CfnParameter>,
) -> Result<(), AppError> {
    create_stack(&make_client(&profile), &name, &template_body, &parameters).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_update_stack(
    profile: ConnectionProfile,
    name: String,
    template_body: String,
    parameters: Vec<CfnParameter>,
) -> Result<(), AppError> {
    update_stack(&make_client(&profile), &name, &template_body, &parameters).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_delete_stack(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    delete_stack(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_get_stack(
    profile: ConnectionProfile,
    name: String,
) -> Result<CfnStackDetail, AppError> {
    get_stack(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_list_resources(
    profile: ConnectionProfile,
    name: String,
) -> Result<Vec<CfnResource>, AppError> {
    list_resources(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_list_events(
    profile: ConnectionProfile,
    name: String,
) -> Result<CfnEventsResult, AppError> {
    list_events(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_get_template(
    profile: ConnectionProfile,
    name: String,
) -> Result<String, AppError> {
    get_template(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cfn_list_exports(profile: ConnectionProfile) -> Result<Vec<CfnExport>, AppError> {
    list_exports(&make_client(&profile)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_summary_serializes_camel_case() {
        let s = CfnStackSummary {
            name: "t7-stack".into(),
            status: "CREATE_COMPLETE".into(),
            status_reason: Some("done".into()),
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "t7-stack");
        assert_eq!(v["status"], "CREATE_COMPLETE");
        assert_eq!(v["statusReason"], "done");
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn parameter_roundtrips_camel_case() {
        let json = serde_json::json!({ "key": "Env", "value": "prod" });
        let p: CfnParameter = serde_json::from_value(json).unwrap();
        assert_eq!(p.key, "Env");
        assert_eq!(p.value, "prod");
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["key"], "Env");
        assert_eq!(v["value"], "prod");
    }

    #[test]
    fn stack_detail_serializes_camel_case() {
        let d = CfnStackDetail {
            name: "t7-stack".into(),
            status: "UPDATE_COMPLETE".into(),
            status_reason: None,
            created_at: Some("2026-07-22T00:00:00Z".into()),
            updated_at: Some("2026-07-22T01:00:00Z".into()),
            outputs: vec![CfnOutput {
                key: "TopicArn".into(),
                value: "arn:aws:sns:...".into(),
                description: Some("the topic".into()),
                export_name: Some("MyTopic".into()),
            }],
            parameters: vec![CfnParameter {
                key: "Env".into(),
                value: "prod".into(),
            }],
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["name"], "t7-stack");
        assert_eq!(v["statusReason"], serde_json::Value::Null);
        assert_eq!(v["updatedAt"], "2026-07-22T01:00:00Z");
        assert_eq!(v["outputs"][0]["key"], "TopicArn");
        assert_eq!(v["outputs"][0]["exportName"], "MyTopic");
        assert_eq!(v["parameters"][0]["key"], "Env");
        assert_eq!(v["parameters"][0]["value"], "prod");
    }

    #[test]
    fn resource_serializes_camel_case() {
        let r = CfnResource {
            logical_id: "ProbeTopic".into(),
            physical_id: Some("arn:aws:sns:...".into()),
            resource_type: "AWS::SNS::Topic".into(),
            status: "CREATE_COMPLETE".into(),
            timestamp: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["logicalId"], "ProbeTopic");
        assert_eq!(v["physicalId"], "arn:aws:sns:...");
        assert_eq!(v["resourceType"], "AWS::SNS::Topic");
        assert_eq!(v["status"], "CREATE_COMPLETE");
        assert_eq!(v["timestamp"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn events_result_serializes_camel_case() {
        let r = CfnEventsResult {
            events: vec![CfnStackEvent {
                event_id: "e1".into(),
                logical_id: Some("ProbeTopic".into()),
                resource_type: Some("AWS::SNS::Topic".into()),
                status: Some("CREATE_COMPLETE".into()),
                reason: None,
                timestamp: Some("2026-07-22T00:00:00Z".into()),
            }],
            supported: true,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["supported"], true);
        assert_eq!(v["events"][0]["eventId"], "e1");
        assert_eq!(v["events"][0]["logicalId"], "ProbeTopic");
        assert_eq!(v["events"][0]["resourceType"], "AWS::SNS::Topic");
        assert_eq!(v["events"][0]["reason"], serde_json::Value::Null);
    }

    #[test]
    fn export_serializes_camel_case() {
        let e = CfnExport {
            name: "MyTopic".into(),
            value: "arn:aws:sns:...".into(),
            exporting_stack_id: Some("arn:aws:cloudformation:...".into()),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["name"], "MyTopic");
        assert_eq!(v["value"], "arn:aws:sns:...");
        assert_eq!(v["exportingStackId"], "arn:aws:cloudformation:...");
    }

    #[test]
    fn to_parameters_maps_key_value() {
        let params = vec![
            CfnParameter {
                key: "A".into(),
                value: "1".into(),
            },
            CfnParameter {
                key: "B".into(),
                value: "2".into(),
            },
        ];
        let mapped = to_parameters(&params);
        assert_eq!(mapped.len(), 2);
        assert_eq!(mapped[0].parameter_key(), Some("A"));
        assert_eq!(mapped[0].parameter_value(), Some("1"));
        assert_eq!(mapped[1].parameter_key(), Some("B"));
    }
}
