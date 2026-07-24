//! CloudWatch **Logs** via the ordinary AWS SDK (JSON protocol, works on all
//! four emulators). Metrics/Alarms live in `cloudwatch_query.rs` because they
//! require the legacy Query protocol (spec §2.1-1).

use aws_sdk_cloudwatchlogs::Client;
use aws_smithy_types::{date_time::Format, DateTime};
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogGroup {
    pub name: String,
    pub retention_in_days: Option<i64>,
    pub stored_bytes: i64,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogStream {
    pub name: String,
    pub last_event_at: Option<String>,
    pub stored_bytes: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub timestamp: Option<String>,
    pub message: String,
    /// Populated by FilterLogEvents (which spans streams); empty for GetLogEvents.
    pub stream: Option<String>,
}

/// Convert epoch-millis (the CloudWatch Logs timestamp unit) to ISO8601.
fn millis_to_iso(millis: Option<i64>) -> Option<String> {
    millis.and_then(|m| DateTime::from_millis(m).fmt(Format::DateTime).ok())
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

pub async fn list_log_groups(client: &Client) -> Result<Vec<LogGroup>, AppError> {
    let out = client
        .describe_log_groups()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .log_groups()
        .iter()
        .map(|g| LogGroup {
            name: g.log_group_name().unwrap_or_default().to_string(),
            retention_in_days: g.retention_in_days().map(|d| d as i64),
            stored_bytes: g.stored_bytes().unwrap_or(0),
            created_at: millis_to_iso(g.creation_time()),
        })
        .collect())
}

pub async fn create_log_group(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_log_group()
        .log_group_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_log_group(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_log_group()
        .log_group_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_log_streams(client: &Client, group: &str) -> Result<Vec<LogStream>, AppError> {
    let out = client
        .describe_log_streams()
        .log_group_name(group)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .log_streams()
        .iter()
        .map(|s| LogStream {
            name: s.log_stream_name().unwrap_or_default().to_string(),
            last_event_at: millis_to_iso(s.last_event_timestamp()),
            // AWS deprecated LogStream.storedBytes (always 0 since 2019); the
            // field is kept for the wire contract but the value is best-effort.
            #[allow(deprecated)]
            stored_bytes: s.stored_bytes().unwrap_or(0),
        })
        .collect())
}

pub async fn get_log_events(
    client: &Client,
    group: &str,
    stream: &str,
) -> Result<Vec<LogEvent>, AppError> {
    let out = client
        .get_log_events()
        .log_group_name(group)
        .log_stream_name(stream)
        .start_from_head(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .events()
        .iter()
        .map(|e| LogEvent {
            timestamp: millis_to_iso(e.timestamp()),
            message: e.message().unwrap_or_default().to_string(),
            stream: None,
        })
        .collect())
}

pub async fn filter_log_events(
    client: &Client,
    group: &str,
    pattern: &str,
) -> Result<Vec<LogEvent>, AppError> {
    let mut op = client.filter_log_events().log_group_name(group);
    if !pattern.trim().is_empty() {
        op = op.filter_pattern(pattern);
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(out
        .events()
        .iter()
        .map(|e| LogEvent {
            timestamp: millis_to_iso(e.timestamp()),
            message: e.message().unwrap_or_default().to_string(),
            stream: e.log_stream_name().map(String::from),
        })
        .collect())
}

// ---- Tauri commands ---------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_list_log_groups(profile: ConnectionProfile) -> Result<Vec<LogGroup>, AppError> {
    list_log_groups(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_create_log_group(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    create_log_group(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_delete_log_group(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    delete_log_group(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_list_log_streams(
    profile: ConnectionProfile,
    group: String,
) -> Result<Vec<LogStream>, AppError> {
    list_log_streams(&client_for(&profile), &group).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_get_log_events(
    profile: ConnectionProfile,
    group: String,
    stream: String,
) -> Result<Vec<LogEvent>, AppError> {
    get_log_events(&client_for(&profile), &group, &stream).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cw_filter_log_events(
    profile: ConnectionProfile,
    group: String,
    pattern: String,
) -> Result<Vec<LogEvent>, AppError> {
    filter_log_events(&client_for(&profile), &group, &pattern).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_group_serializes_camel_case() {
        let g = LogGroup {
            name: "/nlsd/app".into(),
            retention_in_days: Some(7),
            stored_bytes: 1024,
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["name"], "/nlsd/app");
        assert_eq!(v["retentionInDays"], 7);
        assert_eq!(v["storedBytes"], 1024);
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn log_stream_serializes_camel_case() {
        let s = LogStream {
            name: "s1".into(),
            last_event_at: None,
            stored_bytes: 0,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "s1");
        assert_eq!(v["lastEventAt"], serde_json::Value::Null);
        assert_eq!(v["storedBytes"], 0);
    }

    #[test]
    fn log_event_serializes_camel_case() {
        let e = LogEvent {
            timestamp: Some("2026-07-22T00:00:00Z".into()),
            message: "hello".into(),
            stream: Some("s1".into()),
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["timestamp"], "2026-07-22T00:00:00Z");
        assert_eq!(v["message"], "hello");
        assert_eq!(v["stream"], "s1");
    }

    #[test]
    fn millis_to_iso_converts_and_handles_none() {
        assert_eq!(millis_to_iso(None), None);
        assert_eq!(
            millis_to_iso(Some(0)),
            Some("1970-01-01T00:00:00Z".to_string())
        );
    }
}
