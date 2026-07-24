use aws_sdk_ssm::types::{ParameterStringFilter, ParameterType};
use aws_sdk_ssm::Client;
use aws_smithy_types::date_time::Format;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterSummary {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub version: i64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterValue {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub value: String,
    pub version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterHistoryEntry {
    pub version: i64,
    pub value: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutParameterRequest {
    pub name: String,
    pub value: String,
    /// "String" | "StringList" | "SecureString".
    #[serde(rename = "type")]
    pub param_type: String,
    pub overwrite: bool,
    pub description: Option<String>,
}

fn type_to_string(t: Option<&ParameterType>) -> String {
    t.map(|t| t.as_str().to_string()).unwrap_or_default()
}

fn fmt_date(d: Option<&aws_smithy_types::DateTime>) -> Option<String> {
    d.and_then(|d| d.fmt(Format::DateTime).ok())
}

/// List parameters, optionally restricted to those whose name begins with
/// `prefix`. The BeginsWith ParameterFilter is sent to the emulator, but some
/// emulators (floci) ignore it, so the same prefix is applied again in-process
/// to guarantee correct results everywhere.
pub async fn list_parameters(
    client: &Client,
    prefix: Option<&str>,
) -> Result<Vec<ParameterSummary>, AppError> {
    let prefix = prefix.map(str::trim).filter(|p| !p.is_empty());
    let mut summaries = Vec::new();
    let mut next_token: Option<String> = None;
    loop {
        let mut op = client.describe_parameters().max_results(50);
        if let Some(p) = prefix {
            let filter = ParameterStringFilter::builder()
                .key("Name")
                .option("BeginsWith")
                .values(p)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            op = op.parameter_filters(filter);
        }
        if let Some(token) = &next_token {
            op = op.next_token(token);
        }
        let out = op.send().await.map_err(map_sdk_err)?;
        for meta in out.parameters() {
            let name = meta.name().unwrap_or_default().to_string();
            // Defensive client-side prefix filter (floci ignores BeginsWith).
            if let Some(p) = prefix {
                if !name.starts_with(p) {
                    continue;
                }
            }
            summaries.push(ParameterSummary {
                name,
                param_type: type_to_string(meta.r#type()),
                version: meta.version(),
                last_modified: fmt_date(meta.last_modified_date()),
            });
        }
        match out.next_token() {
            Some(t) if !t.is_empty() => next_token = Some(t.to_string()),
            _ => break,
        }
    }
    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

pub async fn get_parameter(
    client: &Client,
    name: &str,
    with_decryption: bool,
) -> Result<ParameterValue, AppError> {
    let out = client
        .get_parameter()
        .name(name)
        .with_decryption(with_decryption)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let p = out
        .parameter()
        .ok_or_else(|| AppError::NotFound(format!("parameter {name} not found")))?;
    Ok(ParameterValue {
        name: p.name().unwrap_or(name).to_string(),
        param_type: type_to_string(p.r#type()),
        value: p.value().unwrap_or_default().to_string(),
        version: p.version(),
    })
}

pub async fn put_parameter(client: &Client, req: &PutParameterRequest) -> Result<(), AppError> {
    let mut op = client
        .put_parameter()
        .name(&req.name)
        .value(&req.value)
        .r#type(ParameterType::from(req.param_type.as_str()))
        .overwrite(req.overwrite);
    if let Some(d) = &req.description {
        if !d.is_empty() {
            op = op.description(d);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_parameter(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_parameter()
        .name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_parameter_history(
    client: &Client,
    name: &str,
) -> Result<Vec<ParameterHistoryEntry>, AppError> {
    let mut entries = Vec::new();
    let mut next_token: Option<String> = None;
    loop {
        let mut op = client
            .get_parameter_history()
            .name(name)
            .with_decryption(true)
            .max_results(50);
        if let Some(token) = &next_token {
            op = op.next_token(token);
        }
        let out = op.send().await.map_err(map_sdk_err)?;
        for p in out.parameters() {
            entries.push(ParameterHistoryEntry {
                version: p.version(),
                value: p.value().unwrap_or_default().to_string(),
                param_type: type_to_string(p.r#type()),
                last_modified: fmt_date(p.last_modified_date()),
            });
        }
        match out.next_token() {
            Some(t) if !t.is_empty() => next_token = Some(t.to_string()),
            _ => break,
        }
    }
    // Newest version first.
    entries.sort_by_key(|e| std::cmp::Reverse(e.version));
    Ok(entries)
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn ssm_list_parameters(
    profile: ConnectionProfile,
    prefix: Option<String>,
) -> Result<Vec<ParameterSummary>, AppError> {
    list_parameters(&client_for(&profile), prefix.as_deref()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssm_get_parameter(
    profile: ConnectionProfile,
    name: String,
    with_decryption: bool,
) -> Result<ParameterValue, AppError> {
    get_parameter(&client_for(&profile), &name, with_decryption).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssm_put_parameter(
    profile: ConnectionProfile,
    req: PutParameterRequest,
) -> Result<(), AppError> {
    put_parameter(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssm_delete_parameter(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    delete_parameter(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ssm_get_parameter_history(
    profile: ConnectionProfile,
    name: String,
) -> Result<Vec<ParameterHistoryEntry>, AppError> {
    get_parameter_history(&client_for(&profile), &name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_summary_serializes_camel_case_with_type_key() {
        let s = ParameterSummary {
            name: "/app/db".into(),
            param_type: "SecureString".into(),
            version: 3,
            last_modified: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "/app/db");
        assert_eq!(v["type"], "SecureString");
        assert_eq!(v["version"], 3);
        assert_eq!(v["lastModified"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn parameter_value_serializes_camel_case() {
        let p = ParameterValue {
            name: "/app/token".into(),
            param_type: "String".into(),
            value: "abc".into(),
            version: 1,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["name"], "/app/token");
        assert_eq!(v["type"], "String");
        assert_eq!(v["value"], "abc");
        assert_eq!(v["version"], 1);
    }

    #[test]
    fn history_entry_serializes_camel_case() {
        let h = ParameterHistoryEntry {
            version: 2,
            value: "v2".into(),
            param_type: "String".into(),
            last_modified: None,
        };
        let v = serde_json::to_value(&h).unwrap();
        assert_eq!(v["version"], 2);
        assert_eq!(v["value"], "v2");
        assert_eq!(v["type"], "String");
        assert_eq!(v["lastModified"], serde_json::Value::Null);
    }

    #[test]
    fn put_request_deserializes_camel_case_type_key() {
        let json = serde_json::json!({
            "name": "/app/flag",
            "value": "on",
            "type": "StringList",
            "overwrite": true,
            "description": "feature flag"
        });
        let req: PutParameterRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.name, "/app/flag");
        assert_eq!(req.value, "on");
        assert_eq!(req.param_type, "StringList");
        assert!(req.overwrite);
        assert_eq!(req.description.as_deref(), Some("feature flag"));
    }

    #[test]
    fn parameter_type_roundtrips_through_string() {
        for name in ["String", "StringList", "SecureString"] {
            assert_eq!(ParameterType::from(name).as_str(), name);
        }
    }
}
