//! Requires a live emulator with ECS support (ministack / floci). localstack:3
//! is ECS-Pro-only and will report the control plane as unsupported.
//! Run with: EMU_ENDPOINT=http://localhost:4780 cargo test --test integration_ecs -- --ignored
//!
//! Endpoint resolution: EMU_ENDPOINT -> DDB_ENDPOINT -> http://localhost:8000.
//! Resources are prefixed with `nlsd-t8-` and cleaned up (clusters, services,
//! task definitions and any started task) so the container can be shared.

use app_lib::commands::ecs::*;
use app_lib::connections::{make_sdk_config, ConnectionProfile};
use aws_sdk_ecs::Client;

fn local_profile() -> ConnectionProfile {
    let endpoint_url = std::env::var("EMU_ENDPOINT")
        .or_else(|_| std::env::var("DDB_ENDPOINT"))
        .unwrap_or_else(|_| "http://localhost:8000".into());
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        endpoint_url,
        region: "ap-northeast-1".into(),
        access_key_id: "dummy".into(),
        secret_access_key: "dummy".into(),
        color: None,
    }
}

fn client() -> Client {
    Client::new(&make_sdk_config(&local_profile()))
}

const CONTAINER_DEFS: &str = r#"[
  {"name":"app","image":"public.ecr.aws/docker/library/busybox:stable","memory":128,"essential":true,"command":["sleep","60"]}
]"#;

/// Control-plane lifecycle: cluster + task definition CRUD. These operations do
/// not start containers, so they run without touching Docker.
#[tokio::test]
#[ignore]
async fn cluster_and_task_definition_lifecycle() {
    let client = client();
    let cluster_name = "nlsd-t8-cluster";
    let family = "nlsd-t8-family";

    // cleanup from a previous run
    let _ = delete_cluster(&client, cluster_name).await;

    // --- cluster CRUD (R75) ---
    create_cluster(&client, cluster_name).await.unwrap();
    let clusters = list_clusters(&client).await.unwrap();
    let c = clusters
        .iter()
        .find(|c| c.name == cluster_name)
        .expect("created cluster should be listed");
    assert_eq!(c.status, "ACTIVE");

    // --- task definition register / list / describe / deregister (R76) ---
    let reg = register_task_definition(&client, family, CONTAINER_DEFS)
        .await
        .unwrap();
    assert_eq!(reg.family, family);
    assert!(reg.revision >= 1);
    assert!(reg.ignored_keys.is_empty());
    let td_arn = reg.arn.clone();

    let defs = list_task_definitions(&client).await.unwrap();
    assert!(
        defs.iter().any(|d| d.family == family),
        "registered family should be listed, got {defs:?}"
    );

    let detail = describe_task_definition(&client, &td_arn).await.unwrap();
    assert_eq!(detail.family, family);
    assert_eq!(detail.containers.len(), 1);
    assert_eq!(detail.containers[0].name, "app");
    assert_eq!(
        detail.containers[0].image,
        "public.ecr.aws/docker/library/busybox:stable"
    );
    assert_eq!(detail.containers[0].memory, Some(128));
    assert!(detail.containers[0].essential);
    assert_eq!(detail.containers[0].command, ["sleep", "60"]);

    // Unknown container keys are accepted and reported as ignored.
    let reg2 = register_task_definition(
        &client,
        family,
        r#"[{"name":"app","image":"busybox","portMappings":[{"containerPort":80}]}]"#,
    )
    .await
    .unwrap();
    assert_eq!(reg2.ignored_keys, vec!["portMappings"]);

    // --- list tasks on an empty cluster (R77) ---
    let tasks = list_tasks(&client, cluster_name).await.unwrap();
    assert!(tasks.is_empty(), "new cluster should have no tasks");

    // --- list services on an empty cluster (R77) ---
    let services = list_services(&client, cluster_name).await.unwrap();
    assert!(services.is_empty(), "new cluster should have no services");

    // cleanup: deregister every revision and delete the cluster.
    for d in list_task_definitions(&client)
        .await
        .unwrap()
        .into_iter()
        .filter(|d| d.family == family)
    {
        let _ = deregister_task_definition(&client, &d.arn).await;
    }
    delete_cluster(&client, cluster_name).await.unwrap();
    assert!(
        !list_clusters(&client)
            .await
            .unwrap()
            .iter()
            .any(|c| c.name == cluster_name),
        "cluster should be gone after delete"
    );
}

/// Service create/update/delete (R77). Uses desiredCount 0 so no task/container
/// is scheduled; on emulators without a default launch type this is skipped.
#[tokio::test]
#[ignore]
async fn service_lifecycle_desired_zero() {
    let client = client();
    let cluster_name = "nlsd-t8-svc-cluster";
    let family = "nlsd-t8-svc-family";
    let service_name = "nlsd-t8-service";

    let _ = delete_cluster(&client, cluster_name).await;
    create_cluster(&client, cluster_name).await.unwrap();
    let reg = register_task_definition(&client, family, CONTAINER_DEFS)
        .await
        .unwrap();

    // Service creation may reject on emulators without a default launch type;
    // treat that as an allowed skip (still exercise cluster/task-def cleanup).
    if let Err(e) = create_service(&client, cluster_name, service_name, &reg.arn, 0).await {
        eprintln!("skipping service lifecycle: create_service failed: {e}");
        let _ = deregister_task_definition(&client, &reg.arn).await;
        let _ = delete_cluster(&client, cluster_name).await;
        return;
    }

    let services = list_services(&client, cluster_name).await.unwrap();
    let svc = services
        .iter()
        .find(|s| s.name == service_name)
        .expect("created service should be listed");
    assert_eq!(svc.desired_count, 0);

    update_service(&client, cluster_name, service_name, 0)
        .await
        .unwrap();

    delete_service(&client, cluster_name, service_name)
        .await
        .unwrap();

    let _ = deregister_task_definition(&client, &reg.arn).await;
    delete_cluster(&client, cluster_name).await.unwrap();
}

/// RunTask / StopTask (R77). This starts a REAL lightweight container on
/// ministack/floci, so it always stops the task and deletes the cluster,
/// including on failure paths. Skipped when the emulator rejects RunTask
/// (e.g. kumo control-plane-only).
#[tokio::test]
#[ignore]
async fn run_and_stop_task_cleans_up() {
    let client = client();
    let cluster_name = "nlsd-t8-run-cluster";
    let family = "nlsd-t8-run-family";

    let _ = delete_cluster(&client, cluster_name).await;
    create_cluster(&client, cluster_name).await.unwrap();
    let reg = register_task_definition(&client, family, CONTAINER_DEFS)
        .await
        .unwrap();

    // Always stop any started task and delete the cluster before returning.
    let cleanup = |client: Client, cluster: String, td: String| async move {
        if let Ok(tasks) = list_tasks(&client, &cluster).await {
            for t in tasks {
                let _ = stop_task(&client, &cluster, &t.arn).await;
            }
        }
        let _ = deregister_task_definition(&client, &td).await;
        let _ = delete_cluster(&client, &cluster).await;
    };

    if let Err(e) = run_task(&client, cluster_name, &reg.arn).await {
        eprintln!("skipping run/stop task: run_task rejected: {e}");
        cleanup(client.clone(), cluster_name.into(), reg.arn.clone()).await;
        return;
    }

    // The started task should appear in the list (any status).
    let mut listed = vec![];
    for _ in 0..10 {
        listed = list_tasks(&client, cluster_name).await.unwrap();
        if !listed.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert!(
        !listed.is_empty(),
        "run task should appear in the task list"
    );

    // Stop every task, then tear the cluster down.
    for t in &listed {
        stop_task(&client, cluster_name, &t.arn).await.unwrap();
    }
    cleanup(client.clone(), cluster_name.into(), reg.arn.clone()).await;
}
