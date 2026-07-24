use std::collections::BTreeSet;

use aws_sdk_ecs::types::ContainerDefinition;
use aws_sdk_ecs::Client;
use aws_smithy_types::date_time::Format;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

// ---- wire types -------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    pub name: String,
    pub arn: String,
    pub status: String,
    pub active_services_count: i32,
    pub running_tasks_count: i32,
    pub pending_tasks_count: i32,
    pub registered_container_instances_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinitionSummary {
    pub arn: String,
    pub family: String,
    pub revision: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDef {
    pub name: String,
    pub image: String,
    pub memory: Option<i32>,
    pub cpu: Option<i32>,
    pub essential: bool,
    pub command: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinitionDetail {
    pub arn: String,
    pub family: String,
    pub revision: i32,
    pub status: String,
    pub registered_at: Option<String>,
    pub containers: Vec<ContainerDef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTaskDefResult {
    pub arn: String,
    pub family: String,
    pub revision: i32,
    /// Keys present in the submitted JSON that this app does not map onto the
    /// SDK request (the UI surfaces these as a note).
    pub ignored_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub name: String,
    pub arn: String,
    pub status: String,
    pub task_definition: String,
    pub desired_count: i32,
    pub running_count: i32,
    pub pending_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub arn: String,
    pub id: String,
    pub task_definition_arn: String,
    pub last_status: String,
    pub desired_status: String,
}

/// Known container-definition keys this app maps onto the SDK request. Any other
/// key in the submitted JSON is reported back as ignored.
const KNOWN_CONTAINER_KEYS: &[&str] = &["name", "image", "memory", "cpu", "essential", "command"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerDefInput {
    name: String,
    image: String,
    #[serde(default)]
    memory: Option<i32>,
    #[serde(default)]
    cpu: Option<i32>,
    #[serde(default)]
    essential: Option<bool>,
    #[serde(default)]
    command: Option<Vec<String>>,
}

/// The last `/`-separated segment of an ARN or resource path.
fn last_segment(s: &str) -> String {
    s.rsplit('/').next().unwrap_or(s).to_string()
}

fn fmt_date(dt: Option<&aws_smithy_types::DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

/// Parse the containerDefinitions JSON textarea into SDK types. Returns the
/// built definitions plus the sorted set of unknown keys (so the UI can note
/// them). Only name/image/memory/cpu/essential/command are mapped; unknown
/// keys are ignored per the spec.
fn parse_container_defs(json: &str) -> Result<(Vec<ContainerDefinition>, Vec<String>), AppError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("containerDefinitions JSON: {e}")))?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::Validation("containerDefinitions must be a JSON array".into()))?;
    if arr.is_empty() {
        return Err(AppError::Validation(
            "containerDefinitions must contain at least one container".into(),
        ));
    }

    let mut ignored: BTreeSet<String> = BTreeSet::new();
    let mut defs: Vec<ContainerDefinition> = Vec::with_capacity(arr.len());
    for item in arr {
        let obj = item.as_object().ok_or_else(|| {
            AppError::Validation("each container definition must be a JSON object".into())
        })?;
        for k in obj.keys() {
            if !KNOWN_CONTAINER_KEYS.contains(&k.as_str()) {
                ignored.insert(k.clone());
            }
        }
        let input: ContainerDefInput = serde_json::from_value(item.clone())
            .map_err(|e| AppError::Validation(format!("container definition: {e}")))?;
        let mut b = ContainerDefinition::builder()
            .name(input.name)
            .image(input.image)
            .essential(input.essential.unwrap_or(true));
        if let Some(m) = input.memory {
            b = b.memory(m);
        }
        if let Some(c) = input.cpu {
            b = b.cpu(c);
        }
        if let Some(cmd) = input.command {
            b = b.set_command(Some(cmd));
        }
        defs.push(b.build());
    }
    Ok((defs, ignored.into_iter().collect()))
}

// ---- core operations (take &Client, unit-testable) --------------------------

pub async fn list_clusters(client: &Client) -> Result<Vec<ClusterSummary>, AppError> {
    let out = client.list_clusters().send().await.map_err(map_sdk_err)?;
    let arns = out.cluster_arns();
    if arns.is_empty() {
        return Ok(vec![]);
    }
    let described = client
        .describe_clusters()
        .set_clusters(Some(arns.to_vec()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    let summaries = described
        .clusters()
        .iter()
        .map(|c| {
            let arn = c.cluster_arn().unwrap_or_default().to_string();
            ClusterSummary {
                name: c
                    .cluster_name()
                    .map(String::from)
                    .unwrap_or_else(|| last_segment(&arn)),
                arn,
                status: c.status().unwrap_or_default().to_string(),
                active_services_count: c.active_services_count(),
                running_tasks_count: c.running_tasks_count(),
                pending_tasks_count: c.pending_tasks_count(),
                registered_container_instances_count: c.registered_container_instances_count(),
            }
        })
        .collect();
    Ok(summaries)
}

pub async fn create_cluster(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_cluster()
        .cluster_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_cluster(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_cluster()
        .cluster(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_task_definitions(
    client: &Client,
) -> Result<Vec<TaskDefinitionSummary>, AppError> {
    let out = client
        .list_task_definitions()
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut defs: Vec<TaskDefinitionSummary> = out
        .task_definition_arns()
        .iter()
        .map(|arn| {
            // The trailing segment is `family:revision`.
            let tail = last_segment(arn);
            let (family, revision) = match tail.rsplit_once(':') {
                Some((f, r)) => (f.to_string(), r.parse::<i32>().unwrap_or(0)),
                None => (tail.clone(), 0),
            };
            TaskDefinitionSummary {
                arn: arn.clone(),
                family,
                revision,
            }
        })
        .collect();
    // Newest revisions first, grouped by family.
    defs.sort_by(|a, b| {
        a.family
            .cmp(&b.family)
            .then_with(|| b.revision.cmp(&a.revision))
    });
    Ok(defs)
}

pub async fn register_task_definition(
    client: &Client,
    family: &str,
    container_defs_json: &str,
) -> Result<RegisterTaskDefResult, AppError> {
    let (defs, ignored_keys) = parse_container_defs(container_defs_json)?;
    let out = client
        .register_task_definition()
        .family(family)
        .set_container_definitions(Some(defs))
        .send()
        .await
        .map_err(map_sdk_err)?;
    let td = out
        .task_definition()
        .ok_or_else(|| AppError::Internal("register returned no task definition".into()))?;
    let arn = td.task_definition_arn().unwrap_or_default().to_string();
    Ok(RegisterTaskDefResult {
        arn,
        family: td.family().unwrap_or(family).to_string(),
        revision: td.revision(),
        ignored_keys,
    })
}

pub async fn describe_task_definition(
    client: &Client,
    arn: &str,
) -> Result<TaskDefinitionDetail, AppError> {
    let out = client
        .describe_task_definition()
        .task_definition(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let td = out
        .task_definition()
        .ok_or_else(|| AppError::NotFound(format!("task definition not found: {arn}")))?;
    let containers = td
        .container_definitions()
        .iter()
        .map(|c| ContainerDef {
            name: c.name().unwrap_or_default().to_string(),
            image: c.image().unwrap_or_default().to_string(),
            memory: c.memory(),
            // Container-level cpu is a non-optional i32 (0 = unset in ECS).
            cpu: Some(c.cpu()).filter(|&v| v != 0),
            essential: c.essential().unwrap_or(false),
            command: c.command().to_vec(),
        })
        .collect();
    Ok(TaskDefinitionDetail {
        arn: td.task_definition_arn().unwrap_or(arn).to_string(),
        family: td.family().unwrap_or_default().to_string(),
        revision: td.revision(),
        status: td
            .status()
            .map(|s| s.as_str().to_string())
            .unwrap_or_default(),
        registered_at: fmt_date(td.registered_at()),
        containers,
    })
}

pub async fn deregister_task_definition(client: &Client, arn: &str) -> Result<(), AppError> {
    client
        .deregister_task_definition()
        .task_definition(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_services(
    client: &Client,
    cluster: &str,
) -> Result<Vec<ServiceSummary>, AppError> {
    let out = client
        .list_services()
        .cluster(cluster)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let arns = out.service_arns();
    if arns.is_empty() {
        return Ok(vec![]);
    }
    let described = client
        .describe_services()
        .cluster(cluster)
        .set_services(Some(arns.to_vec()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    let summaries = described
        .services()
        .iter()
        .map(|s| {
            let arn = s.service_arn().unwrap_or_default().to_string();
            ServiceSummary {
                name: s
                    .service_name()
                    .map(String::from)
                    .unwrap_or_else(|| last_segment(&arn)),
                arn,
                status: s.status().unwrap_or_default().to_string(),
                task_definition: s.task_definition().map(last_segment).unwrap_or_default(),
                desired_count: s.desired_count(),
                running_count: s.running_count(),
                pending_count: s.pending_count(),
            }
        })
        .collect();
    Ok(summaries)
}

pub async fn create_service(
    client: &Client,
    cluster: &str,
    name: &str,
    task_def: &str,
    desired: i32,
) -> Result<(), AppError> {
    client
        .create_service()
        .cluster(cluster)
        .service_name(name)
        .task_definition(task_def)
        .desired_count(desired)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn update_service(
    client: &Client,
    cluster: &str,
    name: &str,
    desired: i32,
) -> Result<(), AppError> {
    client
        .update_service()
        .cluster(cluster)
        .service(name)
        .desired_count(desired)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_service(client: &Client, cluster: &str, name: &str) -> Result<(), AppError> {
    client
        .delete_service()
        .cluster(cluster)
        .service(name)
        .force(true)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_tasks(client: &Client, cluster: &str) -> Result<Vec<TaskSummary>, AppError> {
    let out = client
        .list_tasks()
        .cluster(cluster)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let arns = out.task_arns();
    if arns.is_empty() {
        return Ok(vec![]);
    }
    let described = client
        .describe_tasks()
        .cluster(cluster)
        .set_tasks(Some(arns.to_vec()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    let summaries = described
        .tasks()
        .iter()
        .map(|t| {
            let arn = t.task_arn().unwrap_or_default().to_string();
            TaskSummary {
                id: last_segment(&arn),
                arn,
                task_definition_arn: t
                    .task_definition_arn()
                    .map(last_segment)
                    .unwrap_or_default(),
                last_status: t.last_status().unwrap_or_default().to_string(),
                desired_status: t.desired_status().unwrap_or_default().to_string(),
            }
        })
        .collect();
    Ok(summaries)
}

pub async fn run_task(client: &Client, cluster: &str, task_def: &str) -> Result<(), AppError> {
    client
        .run_task()
        .cluster(cluster)
        .task_definition(task_def)
        .count(1)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn stop_task(client: &Client, cluster: &str, task_arn: &str) -> Result<(), AppError> {
    client
        .stop_task()
        .cluster(cluster)
        .task(task_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ---------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_list_clusters(
    profile: ConnectionProfile,
) -> Result<Vec<ClusterSummary>, AppError> {
    list_clusters(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_create_cluster(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    create_cluster(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_delete_cluster(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    delete_cluster(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_list_task_definitions(
    profile: ConnectionProfile,
) -> Result<Vec<TaskDefinitionSummary>, AppError> {
    list_task_definitions(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_register_task_definition(
    profile: ConnectionProfile,
    family: String,
    container_defs_json: String,
) -> Result<RegisterTaskDefResult, AppError> {
    register_task_definition(&client_for(&profile), &family, &container_defs_json).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_describe_task_definition(
    profile: ConnectionProfile,
    arn: String,
) -> Result<TaskDefinitionDetail, AppError> {
    describe_task_definition(&client_for(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_deregister_task_definition(
    profile: ConnectionProfile,
    arn: String,
) -> Result<(), AppError> {
    deregister_task_definition(&client_for(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_list_services(
    profile: ConnectionProfile,
    cluster: String,
) -> Result<Vec<ServiceSummary>, AppError> {
    list_services(&client_for(&profile), &cluster).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_create_service(
    profile: ConnectionProfile,
    cluster: String,
    name: String,
    task_def: String,
    desired: i32,
) -> Result<(), AppError> {
    create_service(&client_for(&profile), &cluster, &name, &task_def, desired).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_update_service(
    profile: ConnectionProfile,
    cluster: String,
    name: String,
    desired: i32,
) -> Result<(), AppError> {
    update_service(&client_for(&profile), &cluster, &name, desired).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_delete_service(
    profile: ConnectionProfile,
    cluster: String,
    name: String,
) -> Result<(), AppError> {
    delete_service(&client_for(&profile), &cluster, &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_list_tasks(
    profile: ConnectionProfile,
    cluster: String,
) -> Result<Vec<TaskSummary>, AppError> {
    list_tasks(&client_for(&profile), &cluster).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_run_task(
    profile: ConnectionProfile,
    cluster: String,
    task_def: String,
) -> Result<(), AppError> {
    run_task(&client_for(&profile), &cluster, &task_def).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecs_stop_task(
    profile: ConnectionProfile,
    cluster: String,
    task_arn: String,
) -> Result<(), AppError> {
    stop_task(&client_for(&profile), &cluster, &task_arn).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_segment_takes_arn_tail() {
        assert_eq!(
            last_segment("arn:aws:ecs:ap-northeast-1:0:cluster/my-cluster"),
            "my-cluster"
        );
        assert_eq!(
            last_segment("arn:aws:ecs:ap-northeast-1:0:task-definition/fam:3"),
            "fam:3"
        );
        assert_eq!(last_segment("plain"), "plain");
    }

    #[test]
    fn cluster_summary_serializes_camel_case() {
        let s = ClusterSummary {
            name: "c".into(),
            arn: "arn:c".into(),
            status: "ACTIVE".into(),
            active_services_count: 2,
            running_tasks_count: 3,
            pending_tasks_count: 1,
            registered_container_instances_count: 0,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "c");
        assert_eq!(v["arn"], "arn:c");
        assert_eq!(v["status"], "ACTIVE");
        assert_eq!(v["activeServicesCount"], 2);
        assert_eq!(v["runningTasksCount"], 3);
        assert_eq!(v["pendingTasksCount"], 1);
        assert_eq!(v["registeredContainerInstancesCount"], 0);
    }

    #[test]
    fn task_definition_summary_serializes_camel_case() {
        let s = TaskDefinitionSummary {
            arn: "arn:td".into(),
            family: "fam".into(),
            revision: 4,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["arn"], "arn:td");
        assert_eq!(v["family"], "fam");
        assert_eq!(v["revision"], 4);
    }

    #[test]
    fn service_and_task_summaries_serialize_camel_case() {
        let svc = ServiceSummary {
            name: "svc".into(),
            arn: "arn:svc".into(),
            status: "ACTIVE".into(),
            task_definition: "fam:1".into(),
            desired_count: 1,
            running_count: 1,
            pending_count: 0,
        };
        let v = serde_json::to_value(&svc).unwrap();
        assert_eq!(v["taskDefinition"], "fam:1");
        assert_eq!(v["desiredCount"], 1);
        assert_eq!(v["runningCount"], 1);
        assert_eq!(v["pendingCount"], 0);

        let task = TaskSummary {
            arn: "arn:task/abc".into(),
            id: "abc".into(),
            task_definition_arn: "fam:1".into(),
            last_status: "RUNNING".into(),
            desired_status: "RUNNING".into(),
        };
        let tv = serde_json::to_value(&task).unwrap();
        assert_eq!(tv["id"], "abc");
        assert_eq!(tv["taskDefinitionArn"], "fam:1");
        assert_eq!(tv["lastStatus"], "RUNNING");
        assert_eq!(tv["desiredStatus"], "RUNNING");
    }

    #[test]
    fn register_result_serializes_camel_case() {
        let r = RegisterTaskDefResult {
            arn: "arn:td".into(),
            family: "fam".into(),
            revision: 1,
            ignored_keys: vec!["portMappings".into()],
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["arn"], "arn:td");
        assert_eq!(v["ignoredKeys"][0], "portMappings");
    }

    #[test]
    fn parse_container_defs_maps_known_fields() {
        let json = r#"[
            {"name":"web","image":"nginx","memory":128,"essential":true,"command":["nginx","-g","daemon off;"]}
        ]"#;
        let (defs, ignored) = parse_container_defs(json).unwrap();
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name(), Some("web"));
        assert_eq!(defs[0].image(), Some("nginx"));
        assert_eq!(defs[0].memory(), Some(128));
        assert_eq!(defs[0].essential(), Some(true));
        assert_eq!(defs[0].command(), ["nginx", "-g", "daemon off;"]);
        assert!(ignored.is_empty());
    }

    #[test]
    fn parse_container_defs_reports_unknown_keys() {
        let json = r#"[
            {"name":"c","image":"busybox","portMappings":[{"containerPort":80}],"logConfiguration":{}}
        ]"#;
        let (defs, ignored) = parse_container_defs(json).unwrap();
        assert_eq!(defs.len(), 1);
        // essential defaults to true when omitted.
        assert_eq!(defs[0].essential(), Some(true));
        assert_eq!(ignored, vec!["logConfiguration", "portMappings"]);
    }

    #[test]
    fn parse_container_defs_rejects_non_array() {
        let err = parse_container_defs("{}").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn parse_container_defs_rejects_empty_array() {
        let err = parse_container_defs("[]").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn parse_container_defs_rejects_invalid_json() {
        let err = parse_container_defs("not json").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
