use aws_sdk_kafka::types::{BrokerNodeGroupInfo, ClusterInfo};
use aws_sdk_kafka::Client;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Kafka version hardcoded for created clusters. Confirmed accepted by floci
/// (Redpanda) and ministack in the Task 14 probe.
const KAFKA_VERSION: &str = "3.6.0";
/// Broker instance type. Smallest type both floci and ministack accept.
const INSTANCE_TYPE: &str = "kafka.t3.small";
/// Client subnet. Emulators do not model real VPCs, so a placeholder subnet id
/// is enough — probe-confirmed accepted by floci and ministack.
const CLIENT_SUBNET: &str = "subnet-1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MskClusterSummary {
    pub arn: String,
    pub name: String,
    pub state: String,
    pub number_of_broker_nodes: Option<i32>,
    pub kafka_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapBrokers {
    pub plaintext: Option<String>,
    pub tls: Option<String>,
}

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

/// Map an SDK `ClusterInfo` to the wire summary.
fn to_summary(info: &ClusterInfo) -> MskClusterSummary {
    MskClusterSummary {
        arn: info.cluster_arn().unwrap_or_default().to_string(),
        name: info.cluster_name().unwrap_or_default().to_string(),
        state: info
            .state()
            .map(|s| s.as_str().to_string())
            .unwrap_or_default(),
        number_of_broker_nodes: info.number_of_broker_nodes(),
        kafka_version: info
            .current_broker_software_info()
            .and_then(|i| i.kafka_version())
            .map(String::from),
    }
}

pub async fn list_clusters(client: &Client) -> Result<Vec<MskClusterSummary>, AppError> {
    let out = client.list_clusters().send().await.map_err(map_sdk_err)?;
    Ok(out.cluster_info_list().iter().map(to_summary).collect())
}

pub async fn create_cluster(client: &Client, name: &str, num_brokers: i32) -> Result<(), AppError> {
    let broker_info = BrokerNodeGroupInfo::builder()
        .instance_type(INSTANCE_TYPE)
        .client_subnets(CLIENT_SUBNET)
        .build();
    client
        .create_cluster()
        .cluster_name(name)
        .kafka_version(KAFKA_VERSION)
        .number_of_broker_nodes(num_brokers)
        .broker_node_group_info(broker_info)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_cluster(client: &Client, arn: &str) -> Result<(), AppError> {
    client
        .delete_cluster()
        .cluster_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn describe_cluster(client: &Client, arn: &str) -> Result<MskClusterSummary, AppError> {
    let out = client
        .describe_cluster()
        .cluster_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let info = out
        .cluster_info()
        .ok_or_else(|| AppError::NotFound(format!("cluster not found: {arn}")))?;
    Ok(to_summary(info))
}

pub async fn get_bootstrap_brokers(
    client: &Client,
    arn: &str,
) -> Result<BootstrapBrokers, AppError> {
    let out = client
        .get_bootstrap_brokers()
        .cluster_arn(arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    // Emulators return an empty string when a transport variant is unconfigured;
    // normalize empty to None so the UI shows only meaningful endpoints.
    let norm = |s: Option<&str>| s.filter(|v| !v.is_empty()).map(String::from);
    Ok(BootstrapBrokers {
        plaintext: norm(out.bootstrap_broker_string()),
        tls: norm(out.bootstrap_broker_string_tls()),
    })
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn msk_list_clusters(
    profile: ConnectionProfile,
) -> Result<Vec<MskClusterSummary>, AppError> {
    list_clusters(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn msk_create_cluster(
    profile: ConnectionProfile,
    name: String,
    num_brokers: i32,
) -> Result<(), AppError> {
    create_cluster(&make_client(&profile), &name, num_brokers).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn msk_delete_cluster(profile: ConnectionProfile, arn: String) -> Result<(), AppError> {
    delete_cluster(&make_client(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn msk_describe_cluster(
    profile: ConnectionProfile,
    arn: String,
) -> Result<MskClusterSummary, AppError> {
    describe_cluster(&make_client(&profile), &arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn msk_get_bootstrap_brokers(
    profile: ConnectionProfile,
    arn: String,
) -> Result<BootstrapBrokers, AppError> {
    get_bootstrap_brokers(&make_client(&profile), &arn).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cluster_summary_serializes_camel_case() {
        let s = MskClusterSummary {
            arn: "arn:aws:kafka:us-east-1:000000000000:cluster/t14/abc".into(),
            name: "t14".into(),
            state: "ACTIVE".into(),
            number_of_broker_nodes: Some(1),
            kafka_version: Some("3.6.0".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(
            v["arn"],
            "arn:aws:kafka:us-east-1:000000000000:cluster/t14/abc"
        );
        assert_eq!(v["name"], "t14");
        assert_eq!(v["state"], "ACTIVE");
        assert_eq!(v["numberOfBrokerNodes"], 1);
        assert_eq!(v["kafkaVersion"], "3.6.0");
    }

    #[test]
    fn cluster_summary_maps_missing_optionals_to_null() {
        let s = MskClusterSummary {
            arn: "arn".into(),
            name: "n".into(),
            state: "CREATING".into(),
            number_of_broker_nodes: None,
            kafka_version: None,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert!(v["numberOfBrokerNodes"].is_null());
        assert!(v["kafkaVersion"].is_null());
    }

    #[test]
    fn bootstrap_brokers_roundtrips_camel_case() {
        let b = BootstrapBrokers {
            plaintext: Some("host:9092".into()),
            tls: Some("host:9094".into()),
        };
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["plaintext"], "host:9092");
        assert_eq!(v["tls"], "host:9094");
        let back: BootstrapBrokers = serde_json::from_value(v).unwrap();
        assert_eq!(back, b);
    }

    #[test]
    fn bootstrap_brokers_tls_may_be_absent() {
        let b = BootstrapBrokers {
            plaintext: Some("host:9092".into()),
            tls: None,
        };
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["plaintext"], "host:9092");
        assert!(v["tls"].is_null());
    }

    #[test]
    fn to_summary_maps_cluster_info() {
        let info = ClusterInfo::builder()
            .cluster_arn("arn:aws:kafka:us-east-1:000000000000:cluster/t14/xyz")
            .cluster_name("t14")
            .state(aws_sdk_kafka::types::ClusterState::Active)
            .number_of_broker_nodes(3)
            .current_broker_software_info(
                aws_sdk_kafka::types::BrokerSoftwareInfo::builder()
                    .kafka_version("3.6.0")
                    .build(),
            )
            .build();
        let s = to_summary(&info);
        assert_eq!(s.name, "t14");
        assert_eq!(s.state, "ACTIVE");
        assert_eq!(s.number_of_broker_nodes, Some(3));
        assert_eq!(s.kafka_version.as_deref(), Some("3.6.0"));
    }

    #[test]
    fn to_summary_handles_missing_fields() {
        let info = ClusterInfo::builder().cluster_name("bare").build();
        let s = to_summary(&info);
        assert_eq!(s.name, "bare");
        assert_eq!(s.arn, "");
        assert_eq!(s.state, "");
        assert!(s.number_of_broker_nodes.is_none());
        assert!(s.kafka_version.is_none());
    }
}
