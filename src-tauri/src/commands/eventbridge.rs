use aws_sdk_eventbridge::types::{PutEventsRequestEntry, RuleState, Target};
use aws_sdk_eventbridge::Client;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// EventBridge event bus (custom or the built-in `default`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBusSummary {
    pub name: String,
    pub arn: Option<String>,
}

/// A rule on a given bus. `state` is the raw EventBridge state string
/// ("ENABLED" / "DISABLED"); the UI renders a toggle from it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSummary {
    pub name: String,
    pub arn: Option<String>,
    pub state: String,
    pub schedule_expression: Option<String>,
    pub event_pattern: Option<String>,
    pub description: Option<String>,
    pub event_bus_name: String,
}

/// A single target attached to a rule (id + destination ARN).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSummary {
    pub id: String,
    pub arn: String,
}

/// Create/replace a rule. Exactly one of `schedule_expression` /
/// `event_pattern` is normally set, but the emulator decides; both are optional
/// on the wire and empty strings are treated as absent.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutRuleRequest {
    pub name: String,
    pub bus: String,
    pub schedule_expression: Option<String>,
    pub event_pattern: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
}

/// Result of a PutEvents call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutEventsResult {
    pub failed_count: i64,
    pub event_ids: Vec<String>,
}

/// EventBridge treats an absent/empty bus name as the built-in `default` bus.
/// The UI always sends a concrete name; normalize an empty string just in case.
fn bus_or_default(bus: &str) -> &str {
    if bus.trim().is_empty() {
        "default"
    } else {
        bus
    }
}

/// Trim an optional string, treating an empty result as absent.
fn non_empty(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub async fn list_buses(client: &Client) -> Result<Vec<EventBusSummary>, AppError> {
    let out = client
        .list_event_buses()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .event_buses()
        .iter()
        .map(|b| EventBusSummary {
            name: b.name().unwrap_or_default().to_string(),
            arn: b.arn().map(|s| s.to_string()),
        })
        .collect())
}

pub async fn create_bus(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_event_bus()
        .name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bus(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_event_bus()
        .name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_rules(client: &Client, bus: &str) -> Result<Vec<RuleSummary>, AppError> {
    let bus = bus_or_default(bus);
    let out = client
        .list_rules()
        .event_bus_name(bus)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .rules()
        .iter()
        .map(|r| RuleSummary {
            name: r.name().unwrap_or_default().to_string(),
            arn: r.arn().map(|s| s.to_string()),
            state: r
                .state()
                .map(|s| s.as_str().to_string())
                .unwrap_or_else(|| "ENABLED".to_string()),
            schedule_expression: r.schedule_expression().map(|s| s.to_string()),
            event_pattern: r.event_pattern().map(|s| s.to_string()),
            description: r.description().map(|s| s.to_string()),
            event_bus_name: r
                .event_bus_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| bus.to_string()),
        })
        .collect())
}

pub async fn put_rule(client: &Client, req: &PutRuleRequest) -> Result<(), AppError> {
    let bus = bus_or_default(&req.bus);
    let mut op = client
        .put_rule()
        .name(&req.name)
        .event_bus_name(bus)
        .state(if req.enabled {
            RuleState::Enabled
        } else {
            RuleState::Disabled
        });
    if let Some(v) = non_empty(&req.schedule_expression) {
        op = op.schedule_expression(v);
    }
    if let Some(v) = non_empty(&req.event_pattern) {
        op = op.event_pattern(v);
    }
    if let Some(v) = non_empty(&req.description) {
        op = op.description(v);
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_rule(client: &Client, name: &str, bus: &str) -> Result<(), AppError> {
    // force removes the rule even if it still has targets (some emulators
    // reject a plain delete; force matches AWS semantics and is safe here).
    client
        .delete_rule()
        .name(name)
        .event_bus_name(bus_or_default(bus))
        .force(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn enable_rule(client: &Client, name: &str, bus: &str) -> Result<(), AppError> {
    client
        .enable_rule()
        .name(name)
        .event_bus_name(bus_or_default(bus))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn disable_rule(client: &Client, name: &str, bus: &str) -> Result<(), AppError> {
    client
        .disable_rule()
        .name(name)
        .event_bus_name(bus_or_default(bus))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_targets(
    client: &Client,
    rule: &str,
    bus: &str,
) -> Result<Vec<TargetSummary>, AppError> {
    let out = client
        .list_targets_by_rule()
        .rule(rule)
        .event_bus_name(bus_or_default(bus))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .targets()
        .iter()
        .map(|t| TargetSummary {
            id: t.id().to_string(),
            arn: t.arn().to_string(),
        })
        .collect())
}

pub async fn put_target(
    client: &Client,
    rule: &str,
    bus: &str,
    target_id: &str,
    arn: &str,
) -> Result<(), AppError> {
    let target = Target::builder()
        .id(target_id)
        .arn(arn)
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    client
        .put_targets()
        .rule(rule)
        .event_bus_name(bus_or_default(bus))
        .targets(target)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn remove_target(
    client: &Client,
    rule: &str,
    bus: &str,
    target_id: &str,
) -> Result<(), AppError> {
    client
        .remove_targets()
        .rule(rule)
        .event_bus_name(bus_or_default(bus))
        .ids(target_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn put_events(
    client: &Client,
    bus: &str,
    source: &str,
    detail_type: &str,
    detail: &str,
) -> Result<PutEventsResult, AppError> {
    let entry = PutEventsRequestEntry::builder()
        .event_bus_name(bus_or_default(bus))
        .source(source)
        .detail_type(detail_type)
        .detail(detail)
        .build();
    let out = client
        .put_events()
        .entries(entry)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let event_ids = out
        .entries()
        .iter()
        .filter_map(|e| e.event_id().map(|s| s.to_string()))
        .collect();
    Ok(PutEventsResult {
        failed_count: out.failed_entry_count() as i64,
        event_ids,
    })
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn events_list_buses(
    profile: ConnectionProfile,
) -> Result<Vec<EventBusSummary>, AppError> {
    list_buses(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_create_bus(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    create_bus(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_delete_bus(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    delete_bus(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_list_rules(
    profile: ConnectionProfile,
    bus: String,
) -> Result<Vec<RuleSummary>, AppError> {
    list_rules(&client_for(&profile), &bus).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_put_rule(
    profile: ConnectionProfile,
    req: PutRuleRequest,
) -> Result<(), AppError> {
    put_rule(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_delete_rule(
    profile: ConnectionProfile,
    name: String,
    bus: String,
) -> Result<(), AppError> {
    delete_rule(&client_for(&profile), &name, &bus).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_enable_rule(
    profile: ConnectionProfile,
    name: String,
    bus: String,
) -> Result<(), AppError> {
    enable_rule(&client_for(&profile), &name, &bus).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_disable_rule(
    profile: ConnectionProfile,
    name: String,
    bus: String,
) -> Result<(), AppError> {
    disable_rule(&client_for(&profile), &name, &bus).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_list_targets(
    profile: ConnectionProfile,
    rule: String,
    bus: String,
) -> Result<Vec<TargetSummary>, AppError> {
    list_targets(&client_for(&profile), &rule, &bus).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_put_target(
    profile: ConnectionProfile,
    rule: String,
    bus: String,
    target_id: String,
    arn: String,
) -> Result<(), AppError> {
    put_target(&client_for(&profile), &rule, &bus, &target_id, &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_remove_target(
    profile: ConnectionProfile,
    rule: String,
    bus: String,
    target_id: String,
) -> Result<(), AppError> {
    remove_target(&client_for(&profile), &rule, &bus, &target_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn events_put_events(
    profile: ConnectionProfile,
    bus: String,
    source: String,
    detail_type: String,
    detail: String,
) -> Result<PutEventsResult, AppError> {
    put_events(&client_for(&profile), &bus, &source, &detail_type, &detail).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bus_defaults_when_empty() {
        assert_eq!(bus_or_default(""), "default");
        assert_eq!(bus_or_default("   "), "default");
        assert_eq!(bus_or_default("my-bus"), "my-bus");
    }

    #[test]
    fn non_empty_trims_and_filters() {
        assert_eq!(non_empty(&None), None);
        assert_eq!(non_empty(&Some("  ".into())), None);
        assert_eq!(non_empty(&Some("  x ".into())), Some("x".into()));
    }

    #[test]
    fn event_bus_summary_serializes_camel_case() {
        let b = EventBusSummary {
            name: "default".into(),
            arn: Some("arn:aws:events:...:event-bus/default".into()),
        };
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["name"], "default");
        assert_eq!(v["arn"], "arn:aws:events:...:event-bus/default");
    }

    #[test]
    fn rule_summary_serializes_camel_case() {
        let r = RuleSummary {
            name: "r1".into(),
            arn: Some("arn:aws:events:...:rule/r1".into()),
            state: "ENABLED".into(),
            schedule_expression: None,
            event_pattern: Some("{\"source\":[\"nlsd\"]}".into()),
            description: None,
            event_bus_name: "default".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["name"], "r1");
        assert_eq!(v["state"], "ENABLED");
        assert_eq!(v["eventPattern"], "{\"source\":[\"nlsd\"]}");
        assert_eq!(v["scheduleExpression"], serde_json::Value::Null);
        assert_eq!(v["eventBusName"], "default");
    }

    #[test]
    fn target_summary_serializes_camel_case() {
        let t = TargetSummary {
            id: "t1".into(),
            arn: "arn:aws:sqs:...:q".into(),
        };
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["id"], "t1");
        assert_eq!(v["arn"], "arn:aws:sqs:...:q");
    }

    #[test]
    fn put_events_result_serializes_camel_case() {
        let r = PutEventsResult {
            failed_count: 0,
            event_ids: vec!["e1".into(), "e2".into()],
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["failedCount"], 0);
        assert_eq!(v["eventIds"][0], "e1");
        assert_eq!(v["eventIds"][1], "e2");
    }

    #[test]
    fn put_rule_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "name": "r1",
            "bus": "my-bus",
            "eventPattern": "{\"source\":[\"nlsd\"]}",
            "enabled": true
        });
        let req: PutRuleRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.name, "r1");
        assert_eq!(req.bus, "my-bus");
        assert_eq!(
            req.event_pattern.as_deref(),
            Some("{\"source\":[\"nlsd\"]}")
        );
        assert_eq!(req.schedule_expression, None);
        assert!(req.enabled);
    }
}
