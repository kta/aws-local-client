use aws_sdk_athena::types::ResultConfiguration;
use aws_sdk_athena::Client;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Athena writes every query's result set to S3. Emulators (e.g. ministack)
/// fail the execution unless the output bucket exists, so the app always sends
/// a fixed default location; users/tests must ensure this bucket exists.
const DEFAULT_OUTPUT_LOCATION: &str = "s3://nlsd-athena-results/";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRef {
    pub execution_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStatus {
    pub state: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResults {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkgroupSummary {
    pub name: String,
    pub description: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedQuerySummary {
    pub id: String,
    pub name: String,
    pub database: Option<String>,
    pub description: Option<String>,
    pub query_string: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedQueryRef {
    pub named_query_id: String,
}

/// Athena's GetQueryResults returns the column headers as the first data row.
/// Drop it when it exactly matches the ColumnInfo names so the table shows only
/// real data rows (behaviour is uniform across floci / ministack / kumo).
fn strip_header_row(columns: &[String], mut rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    if let Some(first) = rows.first() {
        if first == columns {
            rows.remove(0);
        }
    }
    rows
}

pub async fn start_query(
    client: &Client,
    query: &str,
    workgroup: Option<&str>,
) -> Result<QueryRef, AppError> {
    let mut op = client
        .start_query_execution()
        .query_string(query)
        .result_configuration(
            ResultConfiguration::builder()
                .output_location(DEFAULT_OUTPUT_LOCATION)
                .build(),
        );
    if let Some(wg) = workgroup {
        if !wg.trim().is_empty() {
            op = op.work_group(wg);
        }
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(QueryRef {
        execution_id: out.query_execution_id().unwrap_or_default().to_string(),
    })
}

pub async fn get_query_execution(
    client: &Client,
    execution_id: &str,
) -> Result<QueryStatus, AppError> {
    let out = client
        .get_query_execution()
        .query_execution_id(execution_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let status = out.query_execution().and_then(|q| q.status());
    let state = status
        .and_then(|s| s.state())
        .map(|s| s.as_str().to_string())
        .unwrap_or_default();
    let reason = status
        .and_then(|s| s.state_change_reason())
        .map(String::from);
    Ok(QueryStatus { state, reason })
}

pub async fn get_query_results(
    client: &Client,
    execution_id: &str,
) -> Result<QueryResults, AppError> {
    let out = client
        .get_query_results()
        .query_execution_id(execution_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let result_set = out.result_set();
    let columns: Vec<String> = result_set
        .and_then(|r| r.result_set_metadata())
        .map(|m| {
            m.column_info()
                .iter()
                .map(|c| c.name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let raw_rows: Vec<Vec<String>> = result_set
        .map(|r| {
            r.rows()
                .iter()
                .map(|row| {
                    row.data()
                        .iter()
                        .map(|d| d.var_char_value().unwrap_or_default().to_string())
                        .collect()
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(QueryResults {
        columns: columns.clone(),
        rows: strip_header_row(&columns, raw_rows),
    })
}

pub async fn list_workgroups(client: &Client) -> Result<Vec<WorkgroupSummary>, AppError> {
    let out = client
        .list_work_groups()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .work_groups()
        .iter()
        .map(|w| WorkgroupSummary {
            name: w.name().unwrap_or_default().to_string(),
            description: w.description().map(String::from),
            state: w.state().map(|s| s.as_str().to_string()),
        })
        .collect())
}

pub async fn create_workgroup(
    client: &Client,
    name: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    let mut op = client.create_work_group().name(name);
    if let Some(d) = description {
        if !d.trim().is_empty() {
            op = op.description(d);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_workgroup(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_work_group()
        .work_group(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_named_queries(client: &Client) -> Result<Vec<NamedQuerySummary>, AppError> {
    let ids = client
        .list_named_queries()
        .send()
        .await
        .map_err(map_sdk_err)?
        .named_query_ids()
        .to_vec();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let out = client
        .batch_get_named_query()
        .set_named_query_ids(Some(ids))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .named_queries()
        .iter()
        .map(|n| NamedQuerySummary {
            id: n.named_query_id().unwrap_or_default().to_string(),
            name: n.name().to_string(),
            database: Some(n.database().to_string()),
            description: n.description().map(String::from),
            query_string: n.query_string().to_string(),
        })
        .collect())
}

pub async fn create_named_query(
    client: &Client,
    name: &str,
    query: &str,
    database: Option<&str>,
) -> Result<NamedQueryRef, AppError> {
    let db = database
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .unwrap_or("default");
    let out = client
        .create_named_query()
        .name(name)
        .database(db)
        .query_string(query)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(NamedQueryRef {
        named_query_id: out.named_query_id().unwrap_or_default().to_string(),
    })
}

pub async fn delete_named_query(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_named_query()
        .named_query_id(id)
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
pub async fn athena_start_query(
    profile: ConnectionProfile,
    query: String,
    workgroup: Option<String>,
) -> Result<QueryRef, AppError> {
    start_query(&client_for(&profile), &query, workgroup.as_deref()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_get_query_execution(
    profile: ConnectionProfile,
    execution_id: String,
) -> Result<QueryStatus, AppError> {
    get_query_execution(&client_for(&profile), &execution_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_get_query_results(
    profile: ConnectionProfile,
    execution_id: String,
) -> Result<QueryResults, AppError> {
    get_query_results(&client_for(&profile), &execution_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_list_workgroups(
    profile: ConnectionProfile,
) -> Result<Vec<WorkgroupSummary>, AppError> {
    list_workgroups(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_create_workgroup(
    profile: ConnectionProfile,
    name: String,
    description: Option<String>,
) -> Result<(), AppError> {
    create_workgroup(&client_for(&profile), &name, description.as_deref()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_delete_workgroup(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    delete_workgroup(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_list_named_queries(
    profile: ConnectionProfile,
) -> Result<Vec<NamedQuerySummary>, AppError> {
    list_named_queries(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_create_named_query(
    profile: ConnectionProfile,
    name: String,
    query: String,
    database: Option<String>,
) -> Result<NamedQueryRef, AppError> {
    create_named_query(&client_for(&profile), &name, &query, database.as_deref()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn athena_delete_named_query(
    profile: ConnectionProfile,
    id: String,
) -> Result<(), AppError> {
    delete_named_query(&client_for(&profile), &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_header_drops_leading_header_row() {
        let cols = vec!["col".to_string()];
        let rows = vec![vec!["col".to_string()], vec!["value".to_string()]];
        let stripped = strip_header_row(&cols, rows);
        assert_eq!(stripped, vec![vec!["value".to_string()]]);
    }

    #[test]
    fn strip_header_keeps_rows_when_first_is_data() {
        let cols = vec!["col".to_string()];
        let rows = vec![vec!["value".to_string()]];
        let stripped = strip_header_row(&cols, rows.clone());
        assert_eq!(stripped, rows);
    }

    #[test]
    fn strip_header_handles_empty_rows() {
        let cols = vec!["a".to_string(), "b".to_string()];
        let stripped = strip_header_row(&cols, vec![]);
        assert!(stripped.is_empty());
    }

    #[test]
    fn query_ref_serializes_camel_case() {
        let v = serde_json::to_value(QueryRef {
            execution_id: "abc-123".into(),
        })
        .unwrap();
        assert_eq!(v["executionId"], "abc-123");
    }

    #[test]
    fn query_status_serializes_camel_case() {
        let v = serde_json::to_value(QueryStatus {
            state: "SUCCEEDED".into(),
            reason: Some("done".into()),
        })
        .unwrap();
        assert_eq!(v["state"], "SUCCEEDED");
        assert_eq!(v["reason"], "done");
    }

    #[test]
    fn query_results_serializes_camel_case() {
        let v = serde_json::to_value(QueryResults {
            columns: vec!["c1".into(), "c2".into()],
            rows: vec![vec!["a".into(), "b".into()]],
        })
        .unwrap();
        assert_eq!(v["columns"][0], "c1");
        assert_eq!(v["rows"][0][1], "b");
    }

    #[test]
    fn workgroup_summary_serializes_camel_case() {
        let v = serde_json::to_value(WorkgroupSummary {
            name: "primary".into(),
            description: None,
            state: Some("ENABLED".into()),
        })
        .unwrap();
        assert_eq!(v["name"], "primary");
        assert!(v["description"].is_null());
        assert_eq!(v["state"], "ENABLED");
    }

    #[test]
    fn named_query_summary_serializes_camel_case() {
        let v = serde_json::to_value(NamedQuerySummary {
            id: "nq-1".into(),
            name: "daily".into(),
            database: Some("default".into()),
            description: None,
            query_string: "SELECT 1".into(),
        })
        .unwrap();
        assert_eq!(v["id"], "nq-1");
        assert_eq!(v["name"], "daily");
        assert_eq!(v["database"], "default");
        assert_eq!(v["queryString"], "SELECT 1");
    }

    #[test]
    fn named_query_ref_serializes_camel_case() {
        let v = serde_json::to_value(NamedQueryRef {
            named_query_id: "nq-9".into(),
        })
        .unwrap();
        assert_eq!(v["namedQueryId"], "nq-9");
    }
}
