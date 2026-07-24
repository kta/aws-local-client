use std::time::{SystemTime, UNIX_EPOCH};

use aws_sdk_route53::types::{
    Change, ChangeAction, ChangeBatch, HealthCheckConfig, HealthCheckType, ResourceRecord,
    ResourceRecordSet, RrType,
};
use aws_sdk_route53::Client;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedZoneSummary {
    /// Full zone id as returned by the API (e.g. "/hostedzone/Z123"). Passed
    /// back verbatim to record / delete operations.
    pub id: String,
    pub name: String,
    pub record_count: i64,
    pub private_zone: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordSet {
    pub name: String,
    pub record_type: String,
    /// TTL in seconds. Absent for alias records, which this console does not create.
    pub ttl: Option<i64>,
    pub values: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckSummary {
    pub id: String,
    /// IP address or fully-qualified domain name being checked.
    pub target: String,
    pub port: Option<i64>,
    pub check_type: String,
    pub resource_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHealthCheckRequest {
    pub target: String,
    pub port: i64,
    /// "HTTP" | "TCP".
    pub check_type: String,
    pub resource_path: Option<String>,
}

/// Generate a unique CallerReference (Route 53 rejects duplicates).
fn caller_reference() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("nlsd-{nanos}")
}

/// Canonicalize a record-set name to a fully-qualified domain name (single
/// trailing dot). Real Route 53 — and the ministack/floci/localstack emulators
/// — normalize names to an FQDN on write, so their `ListResourceRecordSets`
/// echoes back "www.example.com."; kumo stores and returns the name verbatim,
/// so without this the app would render "www.example.com" on kumo and diverge
/// from every other emulator. Normalizing on the write path keeps the stored
/// (and therefore listed) name canonical everywhere.
fn normalize_fqdn(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.ends_with('.') {
        trimmed.to_string()
    } else {
        format!("{trimmed}.")
    }
}

/// Map the wire action string to the SDK enum, rejecting unknown values.
fn parse_action(action: &str) -> Result<ChangeAction, AppError> {
    match action.to_uppercase().as_str() {
        "CREATE" => Ok(ChangeAction::Create),
        "UPSERT" => Ok(ChangeAction::Upsert),
        "DELETE" => Ok(ChangeAction::Delete),
        other => Err(AppError::Validation(format!(
            "unknown change action: {other}"
        ))),
    }
}

/// Map the wire record-type string to the SDK enum (A/AAAA/CNAME/TXT/MX).
fn parse_record_type(rtype: &str) -> Result<RrType, AppError> {
    match rtype.to_uppercase().as_str() {
        "A" => Ok(RrType::A),
        "AAAA" => Ok(RrType::Aaaa),
        "CNAME" => Ok(RrType::Cname),
        "TXT" => Ok(RrType::Txt),
        "MX" => Ok(RrType::Mx),
        other => Err(AppError::Validation(format!(
            "unsupported record type: {other}"
        ))),
    }
}

/// Map the wire health-check type string to the SDK enum (HTTP/TCP).
fn parse_health_check_type(check_type: &str) -> Result<HealthCheckType, AppError> {
    match check_type.to_uppercase().as_str() {
        "HTTP" => Ok(HealthCheckType::Http),
        "TCP" => Ok(HealthCheckType::Tcp),
        other => Err(AppError::Validation(format!(
            "unsupported health check type: {other}"
        ))),
    }
}

pub async fn list_hosted_zones(client: &Client) -> Result<Vec<HostedZoneSummary>, AppError> {
    let out = client
        .list_hosted_zones()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .hosted_zones()
        .iter()
        .map(|z| HostedZoneSummary {
            id: z.id().to_string(),
            name: z.name().to_string(),
            record_count: z.resource_record_set_count().unwrap_or(0),
            private_zone: z.config().map(|c| c.private_zone()).unwrap_or(false),
        })
        .collect())
}

pub async fn create_hosted_zone(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_hosted_zone()
        .name(name)
        .caller_reference(caller_reference())
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_hosted_zone(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_hosted_zone()
        .id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_record_sets(client: &Client, zone_id: &str) -> Result<Vec<RecordSet>, AppError> {
    let out = client
        .list_resource_record_sets()
        .hosted_zone_id(zone_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .resource_record_sets()
        .iter()
        .map(|r| RecordSet {
            name: r.name().to_string(),
            record_type: r.r#type().as_str().to_string(),
            ttl: r.ttl(),
            values: r
                .resource_records()
                .iter()
                .map(|rr| rr.value().to_string())
                .collect(),
        })
        .collect())
}

pub async fn change_record_set(
    client: &Client,
    zone_id: &str,
    action: &str,
    record: &RecordSet,
) -> Result<(), AppError> {
    let change_action = parse_action(action)?;
    let rtype = parse_record_type(&record.record_type)?;

    let mut records = Vec::new();
    for value in &record.values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        records.push(
            ResourceRecord::builder()
                .value(trimmed)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
    }
    if records.is_empty() {
        return Err(AppError::Validation("値を1つ以上入力してください".into()));
    }

    let mut rrs_builder = ResourceRecordSet::builder()
        .name(normalize_fqdn(&record.name))
        .r#type(rtype)
        .set_resource_records(Some(records));
    if let Some(ttl) = record.ttl {
        rrs_builder = rrs_builder.ttl(ttl);
    }
    let rrs = rrs_builder
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let change = Change::builder()
        .action(change_action)
        .resource_record_set(rrs)
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let batch = ChangeBatch::builder()
        .changes(change)
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    client
        .change_resource_record_sets()
        .hosted_zone_id(zone_id)
        .change_batch(batch)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_health_checks(client: &Client) -> Result<Vec<HealthCheckSummary>, AppError> {
    let out = client
        .list_health_checks()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .health_checks()
        .iter()
        .map(|h| {
            let cfg = h.health_check_config();
            let target = cfg
                .and_then(|c| {
                    c.ip_address()
                        .or_else(|| c.fully_qualified_domain_name())
                        .map(String::from)
                })
                .unwrap_or_default();
            HealthCheckSummary {
                id: h.id().to_string(),
                target,
                port: cfg.and_then(|c| c.port()).map(i64::from),
                check_type: cfg
                    .map(|c| c.r#type().as_str().to_string())
                    .unwrap_or_default(),
                resource_path: cfg.and_then(|c| c.resource_path()).map(String::from),
            }
        })
        .collect())
}

pub async fn create_health_check(
    client: &Client,
    req: &CreateHealthCheckRequest,
) -> Result<(), AppError> {
    let hc_type = parse_health_check_type(&req.check_type)?;

    let mut cfg = HealthCheckConfig::builder()
        .r#type(hc_type)
        .port(req.port as i32)
        .request_interval(30)
        .failure_threshold(3);
    // A numeric target is an IPAddress; anything else is a domain name.
    if req.target.trim().parse::<std::net::IpAddr>().is_ok() {
        cfg = cfg.ip_address(req.target.trim());
    } else {
        cfg = cfg.fully_qualified_domain_name(req.target.trim());
    }
    if let Some(path) = &req.resource_path {
        if !path.trim().is_empty() {
            cfg = cfg.resource_path(path.trim());
        }
    }
    let cfg = cfg.build().map_err(|e| AppError::Internal(e.to_string()))?;

    client
        .create_health_check()
        .caller_reference(caller_reference())
        .health_check_config(cfg)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_health_check(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_health_check()
        .health_check_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_list_hosted_zones(
    profile: ConnectionProfile,
) -> Result<Vec<HostedZoneSummary>, AppError> {
    list_hosted_zones(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_create_hosted_zone(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    create_hosted_zone(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_delete_hosted_zone(
    profile: ConnectionProfile,
    id: String,
) -> Result<(), AppError> {
    delete_hosted_zone(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_list_record_sets(
    profile: ConnectionProfile,
    zone_id: String,
) -> Result<Vec<RecordSet>, AppError> {
    list_record_sets(&client_for(&profile), &zone_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_change_record_set(
    profile: ConnectionProfile,
    zone_id: String,
    action: String,
    record: RecordSet,
) -> Result<(), AppError> {
    change_record_set(&client_for(&profile), &zone_id, &action, &record).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_list_health_checks(
    profile: ConnectionProfile,
) -> Result<Vec<HealthCheckSummary>, AppError> {
    list_health_checks(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_create_health_check(
    profile: ConnectionProfile,
    req: CreateHealthCheckRequest,
) -> Result<(), AppError> {
    create_health_check(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn route53_delete_health_check(
    profile: ConnectionProfile,
    id: String,
) -> Result<(), AppError> {
    delete_health_check(&client_for(&profile), &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_zone_summary_serializes_camel_case() {
        let z = HostedZoneSummary {
            id: "/hostedzone/Z123".into(),
            name: "example.com.".into(),
            record_count: 4,
            private_zone: false,
        };
        let v = serde_json::to_value(&z).unwrap();
        assert_eq!(v["id"], "/hostedzone/Z123");
        assert_eq!(v["name"], "example.com.");
        assert_eq!(v["recordCount"], 4);
        assert_eq!(v["privateZone"], false);
    }

    #[test]
    fn record_set_roundtrips_camel_case() {
        let json = serde_json::json!({
            "name": "www.example.com.",
            "recordType": "A",
            "ttl": 300,
            "values": ["1.2.3.4", "5.6.7.8"]
        });
        let r: RecordSet = serde_json::from_value(json).unwrap();
        assert_eq!(r.name, "www.example.com.");
        assert_eq!(r.record_type, "A");
        assert_eq!(r.ttl, Some(300));
        assert_eq!(r.values, vec!["1.2.3.4", "5.6.7.8"]);
        let back = serde_json::to_value(&r).unwrap();
        assert_eq!(back["recordType"], "A");
        assert_eq!(back["values"][1], "5.6.7.8");
    }

    #[test]
    fn health_check_summary_serializes_camel_case() {
        let h = HealthCheckSummary {
            id: "hc-1".into(),
            target: "127.0.0.1".into(),
            port: Some(80),
            check_type: "TCP".into(),
            resource_path: None,
        };
        let v = serde_json::to_value(&h).unwrap();
        assert_eq!(v["id"], "hc-1");
        assert_eq!(v["target"], "127.0.0.1");
        assert_eq!(v["port"], 80);
        assert_eq!(v["checkType"], "TCP");
        assert_eq!(v["resourcePath"], serde_json::Value::Null);
    }

    #[test]
    fn create_health_check_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "target": "example.com",
            "port": 443,
            "checkType": "HTTP",
            "resourcePath": "/health"
        });
        let req: CreateHealthCheckRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.target, "example.com");
        assert_eq!(req.port, 443);
        assert_eq!(req.check_type, "HTTP");
        assert_eq!(req.resource_path.as_deref(), Some("/health"));
    }

    #[test]
    fn normalize_fqdn_appends_a_single_trailing_dot() {
        assert_eq!(normalize_fqdn("www.example.com"), "www.example.com.");
        // Already an FQDN: unchanged (no double dot).
        assert_eq!(normalize_fqdn("www.example.com."), "www.example.com.");
        // Surrounding whitespace is trimmed.
        assert_eq!(normalize_fqdn("  www.example.com  "), "www.example.com.");
        // Empty stays empty (validated elsewhere).
        assert_eq!(normalize_fqdn(""), "");
    }

    #[test]
    fn parse_action_accepts_the_three_verbs() {
        assert_eq!(parse_action("CREATE").unwrap(), ChangeAction::Create);
        assert_eq!(parse_action("upsert").unwrap(), ChangeAction::Upsert);
        assert_eq!(parse_action("Delete").unwrap(), ChangeAction::Delete);
        assert!(matches!(
            parse_action("PATCH"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn parse_record_type_covers_supported_types() {
        for (s, expected) in [
            ("A", RrType::A),
            ("AAAA", RrType::Aaaa),
            ("cname", RrType::Cname),
            ("TXT", RrType::Txt),
            ("mx", RrType::Mx),
        ] {
            assert_eq!(parse_record_type(s).unwrap(), expected);
        }
        assert!(matches!(
            parse_record_type("SRV"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn parse_health_check_type_covers_http_tcp() {
        assert_eq!(
            parse_health_check_type("HTTP").unwrap(),
            HealthCheckType::Http
        );
        assert_eq!(
            parse_health_check_type("tcp").unwrap(),
            HealthCheckType::Tcp
        );
        assert!(matches!(
            parse_health_check_type("HTTPS"),
            Err(AppError::Validation(_))
        ));
    }
}
