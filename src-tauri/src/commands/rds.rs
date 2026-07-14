use aws_sdk_rds::types::DbInstance;
use aws_sdk_rds::Client;
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
