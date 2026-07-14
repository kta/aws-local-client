use std::collections::HashMap;

use aws_sdk_sns::types::MessageAttributeValue;
use aws_sdk_sns::Client;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSummary {
    pub topic_arn: String,
    pub name: String,
    pub fifo: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnsSubscription {
    pub subscription_arn: String,
    pub protocol: String,
    pub endpoint: String,
    pub filter_policy: Option<String>,
    pub raw_delivery: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttributeInput {
    pub data_type: String,
    pub string_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub message: String,
    pub subject: Option<String>,
    pub attributes: Option<HashMap<String, MessageAttributeInput>>,
    pub group_id: Option<String>,
    pub dedup_id: Option<String>,
}

/// The topic name is the last colon-separated segment of the topic ARN.
fn topic_name_from_arn(arn: &str) -> String {
    arn.rsplit(':').next().unwrap_or(arn).to_string()
}

/// FIFO topics must have a `.fifo` suffix; append it when missing.
fn fifo_topic_name(name: &str, fifo: bool) -> String {
    if fifo && !name.ends_with(".fifo") {
        format!("{name}.fifo")
    } else {
        name.to_string()
    }
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

pub async fn list_topics(client: &Client) -> Result<Vec<TopicSummary>, AppError> {
    let out = client.list_topics().send().await.map_err(map_sdk_err)?;
    let topics = out
        .topics()
        .iter()
        .filter_map(|t| t.topic_arn().map(|arn| arn.to_string()))
        .map(|arn| {
            let name = topic_name_from_arn(&arn);
            let fifo = name.ends_with(".fifo");
            TopicSummary {
                topic_arn: arn,
                name,
                fifo,
            }
        })
        .collect();
    Ok(topics)
}

pub async fn create_topic(client: &Client, name: &str, fifo: bool) -> Result<(), AppError> {
    let name = fifo_topic_name(name, fifo);
    let mut op = client.create_topic().name(&name);
    if fifo {
        op = op.attributes("FifoTopic", "true");
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_topic(client: &Client, topic_arn: &str) -> Result<(), AppError> {
    client
        .delete_topic()
        .topic_arn(topic_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_subscriptions(
    client: &Client,
    topic_arn: &str,
) -> Result<Vec<SnsSubscription>, AppError> {
    let out = client
        .list_subscriptions_by_topic()
        .topic_arn(topic_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut subs = vec![];
    for s in out.subscriptions() {
        let subscription_arn = s.subscription_arn().unwrap_or_default().to_string();
        let protocol = s.protocol().unwrap_or_default().to_string();
        let endpoint = s.endpoint().unwrap_or_default().to_string();
        // Confirmed subscriptions carry a real ARN; pending ones (e.g.
        // "PendingConfirmation") cannot be queried for attributes.
        let (filter_policy, raw_delivery) = if subscription_arn.starts_with("arn:") {
            let attrs = client
                .get_subscription_attributes()
                .subscription_arn(&subscription_arn)
                .send()
                .await
                .map_err(map_sdk_err)?
                .attributes()
                .cloned()
                .unwrap_or_default();
            let filter_policy = attrs.get("FilterPolicy").cloned();
            let raw_delivery = attrs.get("RawMessageDelivery").map(String::as_str) == Some("true");
            (filter_policy, raw_delivery)
        } else {
            (None, false)
        };
        subs.push(SnsSubscription {
            subscription_arn,
            protocol,
            endpoint,
            filter_policy,
            raw_delivery,
        });
    }
    Ok(subs)
}

pub async fn subscribe_sqs(
    client: &Client,
    topic_arn: &str,
    queue_arn: &str,
    filter_policy: Option<&str>,
    raw_delivery: bool,
) -> Result<(), AppError> {
    let mut op = client
        .subscribe()
        .topic_arn(topic_arn)
        .protocol("sqs")
        .endpoint(queue_arn)
        .return_subscription_arn(true);
    if let Some(policy) = filter_policy {
        if !policy.trim().is_empty() {
            op = op.attributes("FilterPolicy", policy);
        }
    }
    if raw_delivery {
        op = op.attributes("RawMessageDelivery", "true");
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn unsubscribe(client: &Client, subscription_arn: &str) -> Result<(), AppError> {
    client
        .unsubscribe()
        .subscription_arn(subscription_arn)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn publish(
    client: &Client,
    topic_arn: &str,
    req: &PublishRequest,
) -> Result<String, AppError> {
    let mut op = client.publish().topic_arn(topic_arn).message(&req.message);
    if let Some(subject) = &req.subject {
        if !subject.is_empty() {
            op = op.subject(subject);
        }
    }
    if let Some(g) = &req.group_id {
        if !g.is_empty() {
            op = op.message_group_id(g);
        }
    }
    if let Some(d) = &req.dedup_id {
        if !d.is_empty() {
            op = op.message_deduplication_id(d);
        }
    }
    if let Some(attrs) = &req.attributes {
        for (name, a) in attrs {
            let value = MessageAttributeValue::builder()
                .data_type(&a.data_type)
                .string_value(&a.string_value)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            op = op.message_attributes(name, value);
        }
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(out.message_id().unwrap_or_default().to_string())
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_list_topics(profile: ConnectionProfile) -> Result<Vec<TopicSummary>, AppError> {
    list_topics(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_create_topic(
    profile: ConnectionProfile,
    name: String,
    fifo: bool,
) -> Result<(), AppError> {
    create_topic(&client_for(&profile), &name, fifo).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_delete_topic(
    profile: ConnectionProfile,
    topic_arn: String,
) -> Result<(), AppError> {
    delete_topic(&client_for(&profile), &topic_arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_list_subscriptions(
    profile: ConnectionProfile,
    topic_arn: String,
) -> Result<Vec<SnsSubscription>, AppError> {
    list_subscriptions(&client_for(&profile), &topic_arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_subscribe_sqs(
    profile: ConnectionProfile,
    topic_arn: String,
    queue_arn: String,
    filter_policy: Option<String>,
    raw_delivery: bool,
) -> Result<(), AppError> {
    subscribe_sqs(
        &client_for(&profile),
        &topic_arn,
        &queue_arn,
        filter_policy.as_deref(),
        raw_delivery,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_unsubscribe(
    profile: ConnectionProfile,
    subscription_arn: String,
) -> Result<(), AppError> {
    unsubscribe(&client_for(&profile), &subscription_arn).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sns_publish(
    profile: ConnectionProfile,
    topic_arn: String,
    req: PublishRequest,
) -> Result<String, AppError> {
    publish(&client_for(&profile), &topic_arn, &req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topic_name_is_last_arn_segment() {
        assert_eq!(
            topic_name_from_arn("arn:aws:sns:ap-northeast-1:000000000000:my-topic"),
            "my-topic"
        );
        assert_eq!(
            topic_name_from_arn("arn:aws:sns:ap-northeast-1:000000000000:orders.fifo"),
            "orders.fifo"
        );
        assert_eq!(topic_name_from_arn("plain"), "plain");
    }

    #[test]
    fn fifo_name_appends_suffix_only_when_needed() {
        assert_eq!(fifo_topic_name("orders", true), "orders.fifo");
        assert_eq!(fifo_topic_name("orders.fifo", true), "orders.fifo");
        assert_eq!(fifo_topic_name("orders", false), "orders");
    }

    #[test]
    fn topic_summary_serializes_camel_case() {
        let s = TopicSummary {
            topic_arn: "arn:aws:sns:...:t".into(),
            name: "t".into(),
            fifo: true,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["topicArn"], "arn:aws:sns:...:t");
        assert_eq!(v["name"], "t");
        assert_eq!(v["fifo"], true);
    }

    #[test]
    fn subscription_serializes_camel_case() {
        let s = SnsSubscription {
            subscription_arn: "arn:aws:sns:...:sub".into(),
            protocol: "sqs".into(),
            endpoint: "arn:aws:sqs:...:q".into(),
            filter_policy: Some("{\"k\":[\"v\"]}".into()),
            raw_delivery: true,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["subscriptionArn"], "arn:aws:sns:...:sub");
        assert_eq!(v["protocol"], "sqs");
        assert_eq!(v["endpoint"], "arn:aws:sqs:...:q");
        assert_eq!(v["filterPolicy"], "{\"k\":[\"v\"]}");
        assert_eq!(v["rawDelivery"], true);
    }

    #[test]
    fn publish_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "message": "hello",
            "subject": "hi",
            "groupId": "g1",
            "dedupId": "d1",
            "attributes": { "k": { "dataType": "String", "stringValue": "v" } }
        });
        let req: PublishRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.message, "hello");
        assert_eq!(req.subject.as_deref(), Some("hi"));
        assert_eq!(req.group_id.as_deref(), Some("g1"));
        assert_eq!(req.dedup_id.as_deref(), Some("d1"));
        let attrs = req.attributes.unwrap();
        assert_eq!(attrs["k"].data_type, "String");
        assert_eq!(attrs["k"].string_value, "v");
    }
}
