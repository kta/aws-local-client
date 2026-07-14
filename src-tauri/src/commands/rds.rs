use aws_sdk_rds::types::DbInstance;
use aws_sdk_rds::Client;
use aws_smithy_types::date_time::Format;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInstanceSummary {
    pub id: String,
    pub engine: String,
    pub status: String,
    pub instance_class: String,
    pub endpoint_address: Option<String>,
    pub endpoint_port: Option<i32>,
    pub allocated_storage: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDbInstanceRequest {
    pub id: String,
    pub engine: String,
    pub instance_class: String,
    pub master_username: String,
    pub master_password: String,
    pub allocated_storage: i32,
}

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

/// Map an SDK `DbInstance` to the wire summary. Endpoint fields are flattened so
/// the UI does not need to model the nested endpoint object.
fn to_summary(instance: &DbInstance) -> DbInstanceSummary {
    let endpoint = instance.endpoint();
    DbInstanceSummary {
        id: instance
            .db_instance_identifier()
            .unwrap_or_default()
            .to_string(),
        engine: instance.engine().unwrap_or_default().to_string(),
        status: instance
            .db_instance_status()
            .unwrap_or_default()
            .to_string(),
        instance_class: instance.db_instance_class().unwrap_or_default().to_string(),
        endpoint_address: endpoint.and_then(|e| e.address()).map(String::from),
        endpoint_port: endpoint.and_then(|e| e.port()),
        allocated_storage: instance.allocated_storage(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyInstanceRequest {
    pub instance_class: Option<String>,
    pub allocated_storage: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSnapshot {
    pub id: String,
    pub instance_id: String,
    pub status: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbParameterGroup {
    pub name: String,
    pub family: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbParameter {
    pub name: String,
    pub value: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParametersResult {
    pub parameters: Vec<DbParameter>,
    pub marker: Option<String>,
}

fn to_snapshot(s: &aws_sdk_rds::types::DbSnapshot) -> DbSnapshot {
    DbSnapshot {
        id: s.db_snapshot_identifier().unwrap_or_default().to_string(),
        instance_id: s.db_instance_identifier().unwrap_or_default().to_string(),
        status: s.status().unwrap_or_default().to_string(),
        created_at: s
            .snapshot_create_time()
            .and_then(|dt| dt.fmt(Format::DateTime).ok()),
    }
}

fn to_parameter_group(g: &aws_sdk_rds::types::DbParameterGroup) -> DbParameterGroup {
    DbParameterGroup {
        name: g.db_parameter_group_name().unwrap_or_default().to_string(),
        family: g
            .db_parameter_group_family()
            .unwrap_or_default()
            .to_string(),
        description: g.description().unwrap_or_default().to_string(),
    }
}

fn to_parameter(p: &aws_sdk_rds::types::Parameter) -> DbParameter {
    DbParameter {
        name: p.parameter_name().unwrap_or_default().to_string(),
        value: p.parameter_value().map(String::from),
        description: p.description().map(String::from),
    }
}

pub async fn list_instances(client: &Client) -> Result<Vec<DbInstanceSummary>, AppError> {
    let out = client
        .describe_db_instances()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.db_instances().iter().map(to_summary).collect())
}

pub async fn create_instance(
    client: &Client,
    req: &CreateDbInstanceRequest,
) -> Result<(), AppError> {
    client
        .create_db_instance()
        .db_instance_identifier(&req.id)
        .engine(&req.engine)
        .db_instance_class(&req.instance_class)
        .master_username(&req.master_username)
        .master_user_password(&req.master_password)
        .allocated_storage(req.allocated_storage)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_instance(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_db_instance()
        .db_instance_identifier(id)
        .skip_final_snapshot(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn stop_instance(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .stop_db_instance()
        .db_instance_identifier(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn start_instance(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .start_db_instance()
        .db_instance_identifier(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn reboot_instance(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .reboot_db_instance()
        .db_instance_identifier(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn modify_instance(
    client: &Client,
    id: &str,
    req: &ModifyInstanceRequest,
) -> Result<(), AppError> {
    client
        .modify_db_instance()
        .db_instance_identifier(id)
        .apply_immediately(true)
        .set_db_instance_class(req.instance_class.clone())
        .set_allocated_storage(req.allocated_storage)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_snapshots(client: &Client) -> Result<Vec<DbSnapshot>, AppError> {
    let out = client
        .describe_db_snapshots()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.db_snapshots().iter().map(to_snapshot).collect())
}

pub async fn create_snapshot(
    client: &Client,
    instance_id: &str,
    snapshot_id: &str,
) -> Result<(), AppError> {
    client
        .create_db_snapshot()
        .db_instance_identifier(instance_id)
        .db_snapshot_identifier(snapshot_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn restore_snapshot(
    client: &Client,
    snapshot_id: &str,
    new_instance_id: &str,
) -> Result<(), AppError> {
    client
        .restore_db_instance_from_db_snapshot()
        .db_snapshot_identifier(snapshot_id)
        .db_instance_identifier(new_instance_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_snapshot(client: &Client, snapshot_id: &str) -> Result<(), AppError> {
    client
        .delete_db_snapshot()
        .db_snapshot_identifier(snapshot_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_parameter_groups(client: &Client) -> Result<Vec<DbParameterGroup>, AppError> {
    let out = client
        .describe_db_parameter_groups()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .db_parameter_groups()
        .iter()
        .map(to_parameter_group)
        .collect())
}

pub async fn create_parameter_group(
    client: &Client,
    name: &str,
    family: &str,
    description: &str,
) -> Result<(), AppError> {
    client
        .create_db_parameter_group()
        .db_parameter_group_name(name)
        .db_parameter_group_family(family)
        .description(description)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_parameter_group(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_db_parameter_group()
        .db_parameter_group_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_parameters(
    client: &Client,
    group_name: &str,
    marker: Option<&str>,
) -> Result<ListParametersResult, AppError> {
    let out = client
        .describe_db_parameters()
        .db_parameter_group_name(group_name)
        .max_records(100)
        .set_marker(marker.map(String::from))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ListParametersResult {
        parameters: out.parameters().iter().map(to_parameter).collect(),
        marker: out.marker().map(String::from),
    })
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_list_instances(
    profile: ConnectionProfile,
) -> Result<Vec<DbInstanceSummary>, AppError> {
    list_instances(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_create_instance(
    profile: ConnectionProfile,
    req: CreateDbInstanceRequest,
) -> Result<(), AppError> {
    create_instance(&make_client(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_delete_instance(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    delete_instance(&make_client(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_stop_instance(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    stop_instance(&make_client(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_start_instance(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    start_instance(&make_client(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_reboot_instance(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    reboot_instance(&make_client(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_modify_instance(
    profile: ConnectionProfile,
    id: String,
    req: ModifyInstanceRequest,
) -> Result<(), AppError> {
    modify_instance(&make_client(&profile), &id, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_list_snapshots(profile: ConnectionProfile) -> Result<Vec<DbSnapshot>, AppError> {
    list_snapshots(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_create_snapshot(
    profile: ConnectionProfile,
    instance_id: String,
    snapshot_id: String,
) -> Result<(), AppError> {
    create_snapshot(&make_client(&profile), &instance_id, &snapshot_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_restore_snapshot(
    profile: ConnectionProfile,
    snapshot_id: String,
    new_instance_id: String,
) -> Result<(), AppError> {
    restore_snapshot(&make_client(&profile), &snapshot_id, &new_instance_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_delete_snapshot(
    profile: ConnectionProfile,
    snapshot_id: String,
) -> Result<(), AppError> {
    delete_snapshot(&make_client(&profile), &snapshot_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_list_parameter_groups(
    profile: ConnectionProfile,
) -> Result<Vec<DbParameterGroup>, AppError> {
    list_parameter_groups(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_create_parameter_group(
    profile: ConnectionProfile,
    name: String,
    family: String,
    description: String,
) -> Result<(), AppError> {
    create_parameter_group(&make_client(&profile), &name, &family, &description).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_delete_parameter_group(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    delete_parameter_group(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rds_list_parameters(
    profile: ConnectionProfile,
    group_name: String,
    marker: Option<String>,
) -> Result<ListParametersResult, AppError> {
    list_parameters(&make_client(&profile), &group_name, marker.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_instance_summary_serializes_camel_case() {
        let s = DbInstanceSummary {
            id: "t4-db".into(),
            engine: "mysql".into(),
            status: "available".into(),
            instance_class: "db.t3.micro".into(),
            endpoint_address: Some("localhost".into()),
            endpoint_port: Some(3306),
            allocated_storage: Some(20),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "t4-db");
        assert_eq!(v["engine"], "mysql");
        assert_eq!(v["status"], "available");
        assert_eq!(v["instanceClass"], "db.t3.micro");
        assert_eq!(v["endpointAddress"], "localhost");
        assert_eq!(v["endpointPort"], 3306);
        assert_eq!(v["allocatedStorage"], 20);
    }

    #[test]
    fn create_request_deserializes_camel_case() {
        let req: CreateDbInstanceRequest = serde_json::from_value(serde_json::json!({
            "id": "t4-db",
            "engine": "postgres",
            "instanceClass": "db.t3.micro",
            "masterUsername": "admin",
            "masterPassword": "secret123",
            "allocatedStorage": 20,
        }))
        .unwrap();
        assert_eq!(req.id, "t4-db");
        assert_eq!(req.engine, "postgres");
        assert_eq!(req.instance_class, "db.t3.micro");
        assert_eq!(req.master_username, "admin");
        assert_eq!(req.master_password, "secret123");
        assert_eq!(req.allocated_storage, 20);
    }

    #[test]
    fn modify_request_deserializes_camel_case_with_optionals() {
        let req: ModifyInstanceRequest = serde_json::from_value(serde_json::json!({
            "instanceClass": "db.t3.small",
            "allocatedStorage": 30,
        }))
        .unwrap();
        assert_eq!(req.instance_class.as_deref(), Some("db.t3.small"));
        assert_eq!(req.allocated_storage, Some(30));

        // Both fields optional: an empty object is valid (no-op modify).
        let empty: ModifyInstanceRequest = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(empty.instance_class.is_none());
        assert!(empty.allocated_storage.is_none());
    }

    #[test]
    fn db_snapshot_serializes_camel_case() {
        let s = DbSnapshot {
            id: "x4-snap".into(),
            instance_id: "x4-db".into(),
            status: "available".into(),
            created_at: Some("2026-07-14T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "x4-snap");
        assert_eq!(v["instanceId"], "x4-db");
        assert_eq!(v["status"], "available");
        assert_eq!(v["createdAt"], "2026-07-14T00:00:00Z");
    }

    #[test]
    fn to_snapshot_maps_missing_time_to_none() {
        let s = aws_sdk_rds::types::DbSnapshot::builder()
            .db_snapshot_identifier("x4-snap")
            .db_instance_identifier("x4-db")
            .status("creating")
            .build();
        let mapped = to_snapshot(&s);
        assert_eq!(mapped.id, "x4-snap");
        assert_eq!(mapped.instance_id, "x4-db");
        assert_eq!(mapped.status, "creating");
        assert!(mapped.created_at.is_none());
    }

    #[test]
    fn db_parameter_group_serializes_camel_case() {
        let g = DbParameterGroup {
            name: "x4-pg".into(),
            family: "mysql8.0".into(),
            description: "test group".into(),
        };
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["name"], "x4-pg");
        assert_eq!(v["family"], "mysql8.0");
        assert_eq!(v["description"], "test group");
    }

    #[test]
    fn to_parameter_maps_optional_fields() {
        let p = aws_sdk_rds::types::Parameter::builder()
            .parameter_name("max_connections")
            .parameter_value("100")
            .description("max connections")
            .build();
        let mapped = to_parameter(&p);
        assert_eq!(mapped.name, "max_connections");
        assert_eq!(mapped.value.as_deref(), Some("100"));
        assert_eq!(mapped.description.as_deref(), Some("max connections"));

        // A parameter with no value/description (common for dynamic params).
        let bare = aws_sdk_rds::types::Parameter::builder()
            .parameter_name("some_flag")
            .build();
        let mapped = to_parameter(&bare);
        assert_eq!(mapped.name, "some_flag");
        assert!(mapped.value.is_none());
        assert!(mapped.description.is_none());
    }

    #[test]
    fn list_parameters_result_serializes_camel_case() {
        let r = ListParametersResult {
            parameters: vec![DbParameter {
                name: "a".into(),
                value: Some("1".into()),
                description: None,
            }],
            marker: Some("next".into()),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["parameters"][0]["name"], "a");
        assert_eq!(v["parameters"][0]["value"], "1");
        assert!(v["parameters"][0]["description"].is_null());
        assert_eq!(v["marker"], "next");
    }

    #[test]
    fn to_summary_maps_missing_endpoint_to_none() {
        let instance = DbInstance::builder()
            .db_instance_identifier("t4-db")
            .engine("mysql")
            .db_instance_status("creating")
            .db_instance_class("db.t3.micro")
            .build();
        let summary = to_summary(&instance);
        assert_eq!(summary.id, "t4-db");
        assert_eq!(summary.status, "creating");
        assert!(summary.endpoint_address.is_none());
        assert!(summary.endpoint_port.is_none());
    }
}
