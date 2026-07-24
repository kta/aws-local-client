use aws_sdk_opensearch::types::DomainStatus;
use aws_sdk_opensearch::Client;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Row shape for the domains list (name / engine version / status). Status is
/// modelled as the `processing`/`created` flags OpenSearch exposes rather than a
/// single string, so the UI can render "アクティブ" vs "処理中" consistently.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainSummary {
    pub name: String,
    pub engine_version: Option<String>,
    pub processing: bool,
    pub created: bool,
}

/// Detail shape: adds the endpoint URL on top of the summary fields.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainDetail {
    pub name: String,
    pub endpoint: Option<String>,
    pub engine_version: Option<String>,
    pub processing: bool,
    pub created: bool,
}

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

fn to_summary(s: &DomainStatus) -> DomainSummary {
    DomainSummary {
        name: s.domain_name().to_string(),
        engine_version: s.engine_version().map(String::from),
        processing: s.processing().unwrap_or(false),
        created: s.created().unwrap_or(false),
    }
}

fn to_detail(s: &DomainStatus) -> DomainDetail {
    DomainDetail {
        name: s.domain_name().to_string(),
        endpoint: s.endpoint().map(String::from),
        engine_version: s.engine_version().map(String::from),
        processing: s.processing().unwrap_or(false),
        created: s.created().unwrap_or(false),
    }
}

/// List domains, enriched with engine version + status via a batch describe.
/// `ListDomainNames` alone only returns names + engine type, so a follow-up
/// `DescribeDomains` fills in the columns the console shows.
pub async fn list_domains(client: &Client) -> Result<Vec<DomainSummary>, AppError> {
    let names_out = client
        .list_domain_names()
        .send()
        .await
        .map_err(map_sdk_err)?;
    let names: Vec<String> = names_out
        .domain_names()
        .iter()
        .filter_map(|d| d.domain_name().map(String::from))
        .collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let out = client
        .describe_domains()
        .set_domain_names(Some(names))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.domain_status_list().iter().map(to_summary).collect())
}

pub async fn create_domain(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_domain()
        .domain_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_domain(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_domain()
        .domain_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_domain(client: &Client, name: &str) -> Result<DomainDetail, AppError> {
    let out = client
        .describe_domain()
        .domain_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let status = out
        .domain_status()
        .ok_or_else(|| AppError::NotFound(format!("domain {name} not found")))?;
    Ok(to_detail(status))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn opensearch_list_domains(
    profile: ConnectionProfile,
) -> Result<Vec<DomainSummary>, AppError> {
    list_domains(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opensearch_create_domain(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    create_domain(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opensearch_delete_domain(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    delete_domain(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opensearch_get_domain(
    profile: ConnectionProfile,
    name: String,
) -> Result<DomainDetail, AppError> {
    get_domain(&make_client(&profile), &name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_summary_serializes_camel_case() {
        let s = DomainSummary {
            name: "logs".into(),
            engine_version: Some("OpenSearch_2.11".into()),
            processing: false,
            created: true,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "logs");
        assert_eq!(v["engineVersion"], "OpenSearch_2.11");
        assert_eq!(v["processing"], false);
        assert_eq!(v["created"], true);
    }

    #[test]
    fn domain_detail_serializes_camel_case() {
        let d = DomainDetail {
            name: "logs".into(),
            endpoint: Some("logs.example:9200".into()),
            engine_version: Some("OpenSearch_2.11".into()),
            processing: true,
            created: false,
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["name"], "logs");
        assert_eq!(v["endpoint"], "logs.example:9200");
        assert_eq!(v["engineVersion"], "OpenSearch_2.11");
        assert_eq!(v["processing"], true);
        assert_eq!(v["created"], false);
    }

    #[test]
    fn to_summary_maps_missing_optionals_to_defaults() {
        let s = DomainStatus::builder()
            .domain_id("000000000000/bare")
            .domain_name("bare")
            .arn("arn:aws:es:region:0:domain/bare")
            .set_engine_version(None)
            .set_processing(None)
            .set_created(None)
            .build()
            .unwrap();
        let mapped = to_summary(&s);
        assert_eq!(mapped.name, "bare");
        assert!(mapped.engine_version.is_none());
        assert!(!mapped.processing);
        assert!(!mapped.created);
    }

    #[test]
    fn to_detail_maps_endpoint_and_flags() {
        let s = DomainStatus::builder()
            .domain_id("000000000000/logs")
            .domain_name("logs")
            .arn("arn:aws:es:region:0:domain/logs")
            .endpoint("logs.example:9200")
            .engine_version("OpenSearch_2.11")
            .processing(true)
            .created(false)
            .build()
            .unwrap();
        let mapped = to_detail(&s);
        assert_eq!(mapped.name, "logs");
        assert_eq!(mapped.endpoint.as_deref(), Some("logs.example:9200"));
        assert_eq!(mapped.engine_version.as_deref(), Some("OpenSearch_2.11"));
        assert!(mapped.processing);
        assert!(!mapped.created);
    }
}
