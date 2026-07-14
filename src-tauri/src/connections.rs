use std::path::PathBuf;
use std::time::Duration;

use aws_sdk_dynamodb::config::{BehaviorVersion, Credentials, Region, SharedCredentialsProvider};
use aws_types::sdk_config::SdkConfig;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::AppError;

pub const SCAN_PORTS: [u16; 3] = [4566, 8000, 4567];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub color: Option<String>,
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<Vec<ConnectionProfile>, AppError> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let raw =
            std::fs::read_to_string(&self.path).map_err(|e| AppError::Internal(e.to_string()))?;
        serde_json::from_str(&raw).map_err(|e| AppError::Internal(e.to_string()))
    }

    pub fn upsert(&self, profile: ConnectionProfile) -> Result<Vec<ConnectionProfile>, AppError> {
        let mut all = self.load()?;
        match all.iter_mut().find(|p| p.id == profile.id) {
            Some(slot) => *slot = profile,
            None => all.push(profile),
        }
        self.save(&all)?;
        Ok(all)
    }

    pub fn remove(&self, id: &str) -> Result<Vec<ConnectionProfile>, AppError> {
        let mut all = self.load()?;
        all.retain(|p| p.id != id);
        self.save(&all)?;
        Ok(all)
    }

    fn save(&self, all: &[ConnectionProfile]) -> Result<(), AppError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Internal(e.to_string()))?;
        }
        let raw =
            serde_json::to_string_pretty(all).map_err(|e| AppError::Internal(e.to_string()))?;
        std::fs::write(&self.path, raw).map_err(|e| AppError::Internal(e.to_string()))
    }
}

/// Build a shared AWS `SdkConfig` (creds + timeout + endpoint + region) from a
/// connection profile. Service-specific clients are created from this config,
/// so a new service only needs `aws_sdk_<svc>::Client::new(&make_sdk_config(p))`.
pub fn make_sdk_config(p: &ConnectionProfile) -> SdkConfig {
    let creds = Credentials::new(
        p.access_key_id.clone(),
        p.secret_access_key.clone(),
        None,
        None,
        "profile",
    );
    let timeouts = aws_sdk_dynamodb::config::timeout::TimeoutConfig::builder()
        .connect_timeout(Duration::from_millis(1500))
        .operation_timeout(Duration::from_secs(30))
        .build();
    SdkConfig::builder()
        .behavior_version(BehaviorVersion::latest())
        .endpoint_url(p.endpoint_url.clone())
        .region(Region::new(p.region.clone()))
        .credentials_provider(SharedCredentialsProvider::new(creds))
        .timeout_config(timeouts)
        .build()
}

pub fn make_client(p: &ConnectionProfile) -> aws_sdk_dynamodb::Client {
    aws_sdk_dynamodb::Client::new(&make_sdk_config(p))
}

pub async fn probe(endpoint_url: &str) -> Option<usize> {
    let probe_profile = ConnectionProfile {
        id: "probe".into(),
        name: "probe".into(),
        endpoint_url: endpoint_url.to_string(),
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    };
    let timeouts = aws_sdk_dynamodb::config::timeout::TimeoutConfig::builder()
        .connect_timeout(Duration::from_millis(700))
        // Heavier emulators (e.g. localstack:3) can take a couple of seconds to
        // answer the first ListTables under CI load; keep the connect timeout
        // tight (dead ports fail fast) but give a responsive port room to reply.
        .operation_timeout(Duration::from_millis(3000))
        .build();
    // Reuse the shared config builder, overriding only the probe-specific timeouts.
    let config = make_sdk_config(&probe_profile)
        .into_builder()
        .timeout_config(timeouts)
        .build();
    let client = aws_sdk_dynamodb::Client::new(&config);
    let out = client.list_tables().send().await.ok()?;
    Some(out.table_names().len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEndpoint {
    pub endpoint_url: String,
    pub table_count: usize,
}

fn store_for(app: &tauri::AppHandle) -> Result<ProfileStore, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(ProfileStore::new(dir.join("connections.json")))
}

#[tauri::command]
pub fn list_connections(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.load()
}

#[tauri::command]
pub fn save_connection(
    app: tauri::AppHandle,
    profile: ConnectionProfile,
) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.upsert(profile)
}

#[tauri::command]
pub fn delete_connection(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<ConnectionProfile>, AppError> {
    store_for(&app)?.remove(&id)
}

#[tauri::command]
pub async fn detect_connections() -> Result<Vec<DetectedEndpoint>, AppError> {
    let mut found = vec![];
    for port in SCAN_PORTS {
        let url = format!("http://localhost:{port}");
        if let Some(table_count) = probe(&url).await {
            found.push(DetectedEndpoint {
                endpoint_url: url,
                table_count,
            });
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.into(),
            name: name.into(),
            endpoint_url: "http://localhost:4566".into(),
            region: "ap-northeast-1".into(),
            access_key_id: "dummy".into(),
            secret_access_key: "dummy".into(),
            color: None,
        }
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        assert_eq!(store.load().unwrap(), vec![]);
    }

    #[test]
    fn upsert_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "a")).unwrap();
        let after = store.upsert(profile("2", "b")).unwrap();
        assert_eq!(after.len(), 2);
        assert_eq!(store.load().unwrap(), after);
    }

    #[test]
    fn upsert_replaces_same_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "before")).unwrap();
        let after = store.upsert(profile("1", "after")).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].name, "after");
    }

    #[test]
    fn remove_deletes_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("connections.json"));
        store.upsert(profile("1", "a")).unwrap();
        let after = store.remove("1").unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn serde_uses_camel_case() {
        let json = serde_json::to_value(profile("1", "a")).unwrap();
        assert!(json.get("endpointUrl").is_some());
        assert!(json.get("accessKeyId").is_some());
    }
}
