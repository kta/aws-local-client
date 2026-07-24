use std::collections::HashMap;

use aws_sdk_lambda::primitives::Blob;
use aws_sdk_lambda::types::{
    Environment, FunctionCode, LayerVersionContentInput, LogType, Runtime,
};
use aws_sdk_lambda::Client;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// The execution role is not meaningful for local emulators, so it is fixed to
/// a dummy ARN rather than exposed in the UI (spec §3.1).
const DUMMY_ROLE_ARN: &str = "arn:aws:iam::000000000000:role/nlsd-dummy";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionSummary {
    pub name: String,
    pub runtime: Option<String>,
    pub handler: Option<String>,
    pub description: Option<String>,
    pub code_size: i64,
    pub memory_size: i32,
    pub timeout: i32,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionDetail {
    pub name: String,
    pub runtime: Option<String>,
    pub handler: Option<String>,
    pub description: Option<String>,
    pub role: String,
    pub code_size: i64,
    pub memory_size: i32,
    pub timeout: i32,
    pub code_sha256: Option<String>,
    pub last_modified: Option<String>,
    pub environment: Vec<EnvVar>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFunctionRequest {
    pub name: String,
    pub runtime: String,
    pub handler: String,
    /// Local filesystem path to the deployment zip (path seam, mirrors S3 upload).
    pub zip_path: String,
    pub memory_size: Option<i32>,
    pub timeout: Option<i32>,
    pub description: Option<String>,
    pub environment: Option<Vec<EnvVarInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFunctionConfigRequest {
    pub memory_size: i32,
    pub timeout: i32,
    pub description: Option<String>,
    pub environment: Vec<EnvVarInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeResult {
    pub status_code: i32,
    pub payload: String,
    pub function_error: Option<String>,
    pub log_tail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerSummary {
    pub name: String,
    pub arn: Option<String>,
    pub version: i64,
    pub version_arn: Option<String>,
    pub description: Option<String>,
    pub created_date: Option<String>,
    pub compatible_runtimes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishLayerRequest {
    pub name: String,
    /// Local filesystem path to the layer zip (path seam).
    pub zip_path: String,
    pub compatible_runtimes: Vec<String>,
    pub description: Option<String>,
}

/// Read a deployment/layer zip from disk. The frontend chooses the path via the
/// dialog plugin (or the `__E2E_UPLOAD_PATH` seam) and Rust reads the bytes,
/// exactly like the S3 upload path (spec §2.1-3).
fn read_zip(path: &str) -> Result<Vec<u8>, AppError> {
    std::fs::read(path).map_err(|e| AppError::Validation(format!("failed to read zip {path}: {e}")))
}

/// Convert an environment map into a stably-ordered Vec for the UI.
fn env_to_vec(vars: &HashMap<String, String>) -> Vec<EnvVar> {
    let mut out: Vec<EnvVar> = vars
        .iter()
        .map(|(k, v)| EnvVar {
            key: k.clone(),
            value: v.clone(),
        })
        .collect();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

/// Build the SDK Environment from UI-provided key/value pairs (empty keys skipped).
fn build_environment(vars: &[EnvVarInput]) -> Environment {
    let map: HashMap<String, String> = vars
        .iter()
        .filter(|v| !v.key.trim().is_empty())
        .map(|v| (v.key.clone(), v.value.clone()))
        .collect();
    Environment::builder().set_variables(Some(map)).build()
}

pub async fn list_functions(client: &Client) -> Result<Vec<FunctionSummary>, AppError> {
    let out = client.list_functions().send().await.map_err(map_sdk_err)?;
    let functions = out
        .functions()
        .iter()
        .map(|f| FunctionSummary {
            name: f.function_name().unwrap_or_default().to_string(),
            runtime: f.runtime().map(|r| r.as_str().to_string()),
            handler: f.handler().map(|h| h.to_string()),
            description: f.description().map(|d| d.to_string()),
            code_size: f.code_size(),
            memory_size: f.memory_size().unwrap_or(0),
            timeout: f.timeout().unwrap_or(0),
            last_modified: f.last_modified().map(|m| m.to_string()),
        })
        .collect();
    Ok(functions)
}

pub async fn get_function(client: &Client, name: &str) -> Result<FunctionDetail, AppError> {
    let out = client
        .get_function()
        .function_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let cfg = out
        .configuration()
        .ok_or_else(|| AppError::Internal("function configuration missing".into()))?;
    let environment = cfg
        .environment()
        .and_then(|e| e.variables())
        .map(env_to_vec)
        .unwrap_or_default();
    Ok(FunctionDetail {
        name: cfg.function_name().unwrap_or_default().to_string(),
        runtime: cfg.runtime().map(|r| r.as_str().to_string()),
        handler: cfg.handler().map(|h| h.to_string()),
        description: cfg.description().map(|d| d.to_string()),
        role: cfg.role().unwrap_or_default().to_string(),
        code_size: cfg.code_size(),
        memory_size: cfg.memory_size().unwrap_or(0),
        timeout: cfg.timeout().unwrap_or(0),
        code_sha256: cfg.code_sha256().map(|s| s.to_string()),
        last_modified: cfg.last_modified().map(|m| m.to_string()),
        environment,
    })
}

pub async fn create_function(client: &Client, req: &CreateFunctionRequest) -> Result<(), AppError> {
    let bytes = read_zip(&req.zip_path)?;
    let code = FunctionCode::builder().zip_file(Blob::new(bytes)).build();
    let mut op = client
        .create_function()
        .function_name(&req.name)
        .runtime(Runtime::from(req.runtime.as_str()))
        .handler(&req.handler)
        .role(DUMMY_ROLE_ARN)
        .code(code);
    if let Some(m) = req.memory_size {
        op = op.memory_size(m);
    }
    if let Some(t) = req.timeout {
        op = op.timeout(t);
    }
    if let Some(d) = &req.description {
        if !d.is_empty() {
            op = op.description(d);
        }
    }
    if let Some(env) = &req.environment {
        if !env.is_empty() {
            op = op.environment(build_environment(env));
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn update_function_code(
    client: &Client,
    name: &str,
    zip_path: &str,
) -> Result<(), AppError> {
    let bytes = read_zip(zip_path)?;
    client
        .update_function_code()
        .function_name(name)
        .zip_file(Blob::new(bytes))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn update_function_config(
    client: &Client,
    name: &str,
    req: &UpdateFunctionConfigRequest,
) -> Result<(), AppError> {
    let mut op = client
        .update_function_configuration()
        .function_name(name)
        .memory_size(req.memory_size)
        .timeout(req.timeout)
        .environment(build_environment(&req.environment));
    if let Some(d) = &req.description {
        op = op.description(d);
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_function(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_function()
        .function_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn invoke(client: &Client, name: &str, payload: &str) -> Result<InvokeResult, AppError> {
    // Default an empty payload to a valid empty JSON object so the emulator's
    // JSON parser does not reject the request.
    let body = if payload.trim().is_empty() {
        "{}".to_string()
    } else {
        payload.to_string()
    };
    let out = client
        .invoke()
        .function_name(name)
        .log_type(LogType::Tail)
        .payload(Blob::new(body.into_bytes()))
        .send()
        .await
        .map_err(map_sdk_err)?;

    let payload = out
        .payload()
        .map(|b| String::from_utf8_lossy(b.as_ref()).to_string())
        .unwrap_or_default();
    // LogResult is base64-encoded per the Lambda API; decode to plain text.
    let log_tail = out
        .log_result()
        .and_then(|s| B64.decode(s).ok())
        .map(|b| String::from_utf8_lossy(&b).to_string());
    Ok(InvokeResult {
        status_code: out.status_code(),
        payload,
        function_error: out.function_error().map(|e| e.to_string()),
        log_tail,
    })
}

pub async fn list_layers(client: &Client) -> Result<Vec<LayerSummary>, AppError> {
    let out = client.list_layers().send().await.map_err(map_sdk_err)?;
    let layers = out
        .layers()
        .iter()
        .map(|l| {
            let latest = l.latest_matching_version();
            LayerSummary {
                name: l.layer_name().unwrap_or_default().to_string(),
                arn: l.layer_arn().map(|a| a.to_string()),
                version: latest.map(|v| v.version()).unwrap_or(0),
                version_arn: latest.and_then(|v| v.layer_version_arn().map(|a| a.to_string())),
                description: latest.and_then(|v| v.description().map(|d| d.to_string())),
                created_date: latest.and_then(|v| v.created_date().map(|d| d.to_string())),
                compatible_runtimes: latest
                    .map(|v| {
                        v.compatible_runtimes()
                            .iter()
                            .map(|r| r.as_str().to_string())
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect();
    Ok(layers)
}

pub async fn publish_layer_version(
    client: &Client,
    req: &PublishLayerRequest,
) -> Result<(), AppError> {
    let bytes = read_zip(&req.zip_path)?;
    let content = LayerVersionContentInput::builder()
        .zip_file(Blob::new(bytes))
        .build();
    let mut op = client
        .publish_layer_version()
        .layer_name(&req.name)
        .content(content);
    for rt in &req.compatible_runtimes {
        if !rt.trim().is_empty() {
            op = op.compatible_runtimes(Runtime::from(rt.as_str()));
        }
    }
    if let Some(d) = &req.description {
        if !d.is_empty() {
            op = op.description(d);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_layer_version(
    client: &Client,
    name: &str,
    version: i64,
) -> Result<(), AppError> {
    client
        .delete_layer_version()
        .layer_name(name)
        .version_number(version)
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
pub async fn lambda_list_functions(
    profile: ConnectionProfile,
) -> Result<Vec<FunctionSummary>, AppError> {
    list_functions(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_get_function(
    profile: ConnectionProfile,
    name: String,
) -> Result<FunctionDetail, AppError> {
    get_function(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_create_function(
    profile: ConnectionProfile,
    req: CreateFunctionRequest,
) -> Result<(), AppError> {
    create_function(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_update_function_code(
    profile: ConnectionProfile,
    name: String,
    zip_path: String,
) -> Result<(), AppError> {
    update_function_code(&client_for(&profile), &name, &zip_path).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_update_function_config(
    profile: ConnectionProfile,
    name: String,
    req: UpdateFunctionConfigRequest,
) -> Result<(), AppError> {
    update_function_config(&client_for(&profile), &name, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_delete_function(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    delete_function(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_invoke(
    profile: ConnectionProfile,
    name: String,
    payload: String,
) -> Result<InvokeResult, AppError> {
    invoke(&client_for(&profile), &name, &payload).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_list_layers(profile: ConnectionProfile) -> Result<Vec<LayerSummary>, AppError> {
    list_layers(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_publish_layer_version(
    profile: ConnectionProfile,
    req: PublishLayerRequest,
) -> Result<(), AppError> {
    publish_layer_version(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn lambda_delete_layer_version(
    profile: ConnectionProfile,
    name: String,
    version: i64,
) -> Result<(), AppError> {
    delete_layer_version(&client_for(&profile), &name, version).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_summary_serializes_camel_case() {
        let s = FunctionSummary {
            name: "fn".into(),
            runtime: Some("python3.12".into()),
            handler: Some("index.handler".into()),
            description: None,
            code_size: 512,
            memory_size: 128,
            timeout: 3,
            last_modified: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "fn");
        assert_eq!(v["runtime"], "python3.12");
        assert_eq!(v["handler"], "index.handler");
        assert_eq!(v["codeSize"], 512);
        assert_eq!(v["memorySize"], 128);
        assert_eq!(v["timeout"], 3);
        assert_eq!(v["lastModified"], "2026-07-22T00:00:00Z");
        assert_eq!(v["description"], serde_json::Value::Null);
    }

    #[test]
    fn function_detail_serializes_camel_case() {
        let d = FunctionDetail {
            name: "fn".into(),
            runtime: Some("nodejs20.x".into()),
            handler: Some("app.handler".into()),
            description: Some("desc".into()),
            role: DUMMY_ROLE_ARN.into(),
            code_size: 1024,
            memory_size: 256,
            timeout: 10,
            code_sha256: Some("abc".into()),
            last_modified: None,
            environment: vec![EnvVar {
                key: "K".into(),
                value: "V".into(),
            }],
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["role"], DUMMY_ROLE_ARN);
        assert_eq!(v["codeSha256"], "abc");
        assert_eq!(v["memorySize"], 256);
        assert_eq!(v["environment"][0]["key"], "K");
        assert_eq!(v["environment"][0]["value"], "V");
    }

    #[test]
    fn invoke_result_serializes_camel_case() {
        let r = InvokeResult {
            status_code: 200,
            payload: "{\"ok\":true}".into(),
            function_error: None,
            log_tail: Some("START...".into()),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["statusCode"], 200);
        assert_eq!(v["payload"], "{\"ok\":true}");
        assert_eq!(v["functionError"], serde_json::Value::Null);
        assert_eq!(v["logTail"], "START...");
    }

    #[test]
    fn layer_summary_serializes_camel_case() {
        let l = LayerSummary {
            name: "layer".into(),
            arn: Some("arn:layer".into()),
            version: 2,
            version_arn: Some("arn:layer:2".into()),
            description: None,
            created_date: Some("2026-07-22T00:00:00Z".into()),
            compatible_runtimes: vec!["python3.12".into()],
        };
        let v = serde_json::to_value(&l).unwrap();
        assert_eq!(v["name"], "layer");
        assert_eq!(v["version"], 2);
        assert_eq!(v["versionArn"], "arn:layer:2");
        assert_eq!(v["createdDate"], "2026-07-22T00:00:00Z");
        assert_eq!(v["compatibleRuntimes"][0], "python3.12");
    }

    #[test]
    fn create_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "name": "fn",
            "runtime": "python3.12",
            "handler": "index.handler",
            "zipPath": "/tmp/fn.zip",
            "memorySize": 256,
            "timeout": 15,
            "description": "d",
            "environment": [{ "key": "K", "value": "V" }],
        });
        let req: CreateFunctionRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.name, "fn");
        assert_eq!(req.runtime, "python3.12");
        assert_eq!(req.handler, "index.handler");
        assert_eq!(req.zip_path, "/tmp/fn.zip");
        assert_eq!(req.memory_size, Some(256));
        assert_eq!(req.timeout, Some(15));
        assert_eq!(req.description.as_deref(), Some("d"));
        let env = req.environment.unwrap();
        assert_eq!(env[0].key, "K");
        assert_eq!(env[0].value, "V");
    }

    #[test]
    fn update_config_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "memorySize": 512,
            "timeout": 30,
            "environment": [{ "key": "A", "value": "1" }],
        });
        let req: UpdateFunctionConfigRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.memory_size, 512);
        assert_eq!(req.timeout, 30);
        assert_eq!(req.environment[0].key, "A");
    }

    #[test]
    fn publish_layer_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "name": "layer",
            "zipPath": "/tmp/layer.zip",
            "compatibleRuntimes": ["python3.12", "python3.11"],
            "description": "d",
        });
        let req: PublishLayerRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.name, "layer");
        assert_eq!(req.zip_path, "/tmp/layer.zip");
        assert_eq!(req.compatible_runtimes, vec!["python3.12", "python3.11"]);
    }

    #[test]
    fn env_to_vec_is_sorted_by_key() {
        let mut m = HashMap::new();
        m.insert("Z".to_string(), "1".to_string());
        m.insert("A".to_string(), "2".to_string());
        let v = env_to_vec(&m);
        assert_eq!(v[0].key, "A");
        assert_eq!(v[1].key, "Z");
    }

    #[test]
    fn build_environment_skips_empty_keys() {
        let vars = vec![
            EnvVarInput {
                key: "K".into(),
                value: "V".into(),
            },
            EnvVarInput {
                key: "  ".into(),
                value: "ignored".into(),
            },
        ];
        let env = build_environment(&vars);
        let map = env.variables().unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("K").unwrap(), "V");
    }
}
