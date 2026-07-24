use aws_sdk_apigateway::types::IntegrationType;
use aws_sdk_apigateway::Client;
use aws_smithy_types::{date_time::Format, DateTime};
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResource {
    pub id: String,
    pub path: String,
    pub parent_id: Option<String>,
    /// HTTP methods configured on this resource (e.g. ["GET", "POST"]).
    pub methods: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSummary {
    pub stage_name: String,
    pub deployment_id: Option<String>,
    pub created_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeySummary {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub created_date: Option<String>,
}

/// Integration configuration for a method. `kind` is "mock" (a canned 200
/// response) or "lambdaProxy" (AWS_PROXY to the given Lambda function ARN).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodIntegration {
    pub kind: String,
    pub lambda_arn: Option<String>,
}

/// Format an optional smithy DateTime into an ISO8601 string.
fn fmt_date(dt: Option<&DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

pub async fn list_apis(client: &Client) -> Result<Vec<ApiSummary>, AppError> {
    let out = client
        .get_rest_apis()
        .limit(500)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let apis = out
        .items()
        .iter()
        .map(|a| ApiSummary {
            id: a.id().unwrap_or_default().to_string(),
            name: a.name().unwrap_or_default().to_string(),
            description: a.description().map(str::to_string),
            created_date: fmt_date(a.created_date()),
        })
        .collect();
    Ok(apis)
}

pub async fn create_api(
    client: &Client,
    name: &str,
    description: Option<&str>,
) -> Result<ApiSummary, AppError> {
    let mut op = client.create_rest_api().name(name);
    if let Some(d) = description {
        if !d.trim().is_empty() {
            op = op.description(d);
        }
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(ApiSummary {
        id: out.id().unwrap_or_default().to_string(),
        name: out.name().unwrap_or_default().to_string(),
        description: out.description().map(str::to_string),
        created_date: fmt_date(out.created_date()),
    })
}

pub async fn delete_api(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_rest_api()
        .rest_api_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_resources(client: &Client, api_id: &str) -> Result<Vec<ApiResource>, AppError> {
    let out = client
        .get_resources()
        .rest_api_id(api_id)
        .limit(500)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut resources: Vec<ApiResource> = out
        .items()
        .iter()
        .map(|r| {
            let mut methods: Vec<String> = r
                .resource_methods()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            methods.sort();
            ApiResource {
                id: r.id().unwrap_or_default().to_string(),
                path: r.path().unwrap_or_default().to_string(),
                parent_id: r.parent_id().map(str::to_string),
                methods,
            }
        })
        .collect();
    // Stable order: parents before children, roughly by path depth then path.
    resources.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(resources)
}

pub async fn create_resource(
    client: &Client,
    api_id: &str,
    parent_id: &str,
    path_part: &str,
) -> Result<ApiResource, AppError> {
    let out = client
        .create_resource()
        .rest_api_id(api_id)
        .parent_id(parent_id)
        .path_part(path_part)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ApiResource {
        id: out.id().unwrap_or_default().to_string(),
        path: out.path().unwrap_or_default().to_string(),
        parent_id: out.parent_id().map(str::to_string),
        methods: vec![],
    })
}

pub async fn put_method(
    client: &Client,
    region: &str,
    api_id: &str,
    resource_id: &str,
    http_method: &str,
    integration: &MethodIntegration,
) -> Result<(), AppError> {
    // The method itself: open (no authorization) so the console demo works.
    client
        .put_method()
        .rest_api_id(api_id)
        .resource_id(resource_id)
        .http_method(http_method)
        .authorization_type("NONE")
        .send()
        .await
        .map_err(map_sdk_err)?;

    // The integration behind the method.
    let mut op = client
        .put_integration()
        .rest_api_id(api_id)
        .resource_id(resource_id)
        .http_method(http_method);
    match integration.kind.as_str() {
        "lambdaProxy" => {
            let arn = integration.lambda_arn.as_deref().ok_or_else(|| {
                AppError::Validation("lambdaProxy integration requires a lambdaArn".into())
            })?;
            // Lambda proxy integrations always POST to the invoke path.
            let uri = format!(
                "arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{arn}/invocations"
            );
            op = op
                .r#type(IntegrationType::AwsProxy)
                .integration_http_method("POST")
                .uri(uri);
        }
        _ => {
            // MOCK integration: return a canned 200 without a backend.
            op = op
                .r#type(IntegrationType::Mock)
                .request_templates("application/json", "{\"statusCode\": 200}");
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn create_deployment(
    client: &Client,
    api_id: &str,
    stage_name: &str,
) -> Result<StageSummary, AppError> {
    // Two-step create so stages appear uniformly across emulators: floci's
    // CreateDeployment ignores the stageName argument (the stage is never
    // created), whereas an explicit CreateStage works on all four emulators.
    let dep = client
        .create_deployment()
        .rest_api_id(api_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let deployment_id = dep.id().unwrap_or_default().to_string();
    let out = client
        .create_stage()
        .rest_api_id(api_id)
        .stage_name(stage_name)
        .deployment_id(&deployment_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(StageSummary {
        stage_name: out.stage_name().unwrap_or(stage_name).to_string(),
        deployment_id: out
            .deployment_id()
            .map(str::to_string)
            .or(Some(deployment_id)),
        created_date: fmt_date(out.created_date()),
    })
}

pub async fn list_stages(client: &Client, api_id: &str) -> Result<Vec<StageSummary>, AppError> {
    let out = client
        .get_stages()
        .rest_api_id(api_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let stages = out
        .item()
        .iter()
        .map(|s| StageSummary {
            stage_name: s.stage_name().unwrap_or_default().to_string(),
            deployment_id: s.deployment_id().map(str::to_string),
            created_date: fmt_date(s.created_date()),
        })
        .collect();
    Ok(stages)
}

pub async fn list_api_keys(client: &Client) -> Result<Vec<ApiKeySummary>, AppError> {
    let out = client
        .get_api_keys()
        .limit(500)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let keys = out
        .items()
        .iter()
        .map(|k| ApiKeySummary {
            id: k.id().unwrap_or_default().to_string(),
            name: k.name().unwrap_or_default().to_string(),
            enabled: k.enabled(),
            created_date: fmt_date(k.created_date()),
        })
        .collect();
    Ok(keys)
}

pub async fn create_api_key(client: &Client, name: &str) -> Result<ApiKeySummary, AppError> {
    let out = client
        .create_api_key()
        .name(name)
        .enabled(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ApiKeySummary {
        id: out.id().unwrap_or_default().to_string(),
        name: out.name().unwrap_or_default().to_string(),
        enabled: out.enabled(),
        created_date: fmt_date(out.created_date()),
    })
}

pub async fn delete_api_key(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_api_key()
        .api_key(id)
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
pub async fn apigw_list_apis(profile: ConnectionProfile) -> Result<Vec<ApiSummary>, AppError> {
    list_apis(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_create_api(
    profile: ConnectionProfile,
    name: String,
    description: Option<String>,
) -> Result<ApiSummary, AppError> {
    create_api(&client_for(&profile), &name, description.as_deref()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_delete_api(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    delete_api(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_get_resources(
    profile: ConnectionProfile,
    api_id: String,
) -> Result<Vec<ApiResource>, AppError> {
    get_resources(&client_for(&profile), &api_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_create_resource(
    profile: ConnectionProfile,
    api_id: String,
    parent_id: String,
    path_part: String,
) -> Result<ApiResource, AppError> {
    create_resource(&client_for(&profile), &api_id, &parent_id, &path_part).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_put_method(
    profile: ConnectionProfile,
    api_id: String,
    resource_id: String,
    http_method: String,
    integration: MethodIntegration,
) -> Result<(), AppError> {
    let region = profile.region.clone();
    put_method(
        &client_for(&profile),
        &region,
        &api_id,
        &resource_id,
        &http_method,
        &integration,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_create_deployment(
    profile: ConnectionProfile,
    api_id: String,
    stage_name: String,
) -> Result<StageSummary, AppError> {
    create_deployment(&client_for(&profile), &api_id, &stage_name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_list_stages(
    profile: ConnectionProfile,
    api_id: String,
) -> Result<Vec<StageSummary>, AppError> {
    list_stages(&client_for(&profile), &api_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_list_api_keys(
    profile: ConnectionProfile,
) -> Result<Vec<ApiKeySummary>, AppError> {
    list_api_keys(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_create_api_key(
    profile: ConnectionProfile,
    name: String,
) -> Result<ApiKeySummary, AppError> {
    create_api_key(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apigw_delete_api_key(profile: ConnectionProfile, id: String) -> Result<(), AppError> {
    delete_api_key(&client_for(&profile), &id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn api_summary_serializes_camel_case() {
        let s = ApiSummary {
            id: "abc123".into(),
            name: "my-api".into(),
            description: Some("demo".into()),
            created_date: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "abc123");
        assert_eq!(v["name"], "my-api");
        assert_eq!(v["description"], "demo");
        assert_eq!(v["createdDate"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn api_resource_serializes_camel_case() {
        let r = ApiResource {
            id: "res1".into(),
            path: "/demo".into(),
            parent_id: Some("root".into()),
            methods: vec!["GET".into(), "POST".into()],
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["id"], "res1");
        assert_eq!(v["path"], "/demo");
        assert_eq!(v["parentId"], "root");
        assert_eq!(v["methods"][0], "GET");
        assert_eq!(v["methods"][1], "POST");
    }

    #[test]
    fn stage_summary_serializes_camel_case() {
        let s = StageSummary {
            stage_name: "dev".into(),
            deployment_id: Some("d1".into()),
            created_date: None,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["stageName"], "dev");
        assert_eq!(v["deploymentId"], "d1");
        assert_eq!(v["createdDate"], Value::Null);
    }

    #[test]
    fn api_key_summary_serializes_camel_case() {
        let k = ApiKeySummary {
            id: "k1".into(),
            name: "prod-key".into(),
            enabled: true,
            created_date: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&k).unwrap();
        assert_eq!(v["id"], "k1");
        assert_eq!(v["name"], "prod-key");
        assert_eq!(v["enabled"], true);
        assert_eq!(v["createdDate"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn method_integration_deserializes_camel_case() {
        let mock: MethodIntegration =
            serde_json::from_value(serde_json::json!({ "kind": "mock" })).unwrap();
        assert_eq!(mock.kind, "mock");
        assert!(mock.lambda_arn.is_none());

        let proxy: MethodIntegration = serde_json::from_value(serde_json::json!({
            "kind": "lambdaProxy",
            "lambdaArn": "arn:aws:lambda:us-east-1:000000000000:function:fn"
        }))
        .unwrap();
        assert_eq!(proxy.kind, "lambdaProxy");
        assert_eq!(
            proxy.lambda_arn.as_deref(),
            Some("arn:aws:lambda:us-east-1:000000000000:function:fn")
        );
    }
}
