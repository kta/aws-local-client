use std::collections::HashMap;

use aws_sdk_sqs::types::{MessageAttributeValue, MessageSystemAttributeName, QueueAttributeName};
use aws_sdk_sqs::Client;
use aws_smithy_types::{date_time::Format, DateTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSummary {
    pub queue_url: String,
    pub name: String,
    pub fifo: bool,
    pub approximate_messages: i64,
    pub approximate_not_visible: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueDetail {
    pub queue_url: String,
    pub name: String,
    pub fifo: bool,
    pub approximate_messages: i64,
    pub approximate_not_visible: i64,
    pub arn: String,
    pub visibility_timeout: i64,
    pub retention_period: i64,
    pub delay_seconds: i64,
    pub max_message_size: i64,
    pub redrive_policy: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQueueRequest {
    pub name: String,
    pub fifo: bool,
    pub visibility_timeout: Option<i64>,
    pub retention_period: Option<i64>,
    pub delay_seconds: Option<i64>,
    pub redrive_policy: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueAttributesUpdate {
    pub visibility_timeout: i64,
    pub retention_period: i64,
    pub delay_seconds: i64,
    pub redrive_policy: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttributeInput {
    pub data_type: String,
    pub string_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub body: String,
    pub delay_seconds: Option<i64>,
    pub attributes: Option<HashMap<String, MessageAttributeInput>>,
    pub group_id: Option<String>,
    pub dedup_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueTag {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlqSourceInfo {
    /// This queue's own RedrivePolicy JSON, if configured.
    pub redrive_policy: Option<String>,
    /// Names of the queues that use this queue as their dead-letter target.
    pub sources: Vec<String>,
    /// False when the emulator does not implement ListDeadLetterSourceQueues.
    pub supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqsMessage {
    pub message_id: String,
    pub receipt_handle: String,
    pub body: String,
    pub attributes: Value,
    pub sent_at: Option<String>,
}

/// The queue name is the last path segment of the queue URL.
fn queue_name_from_url(url: &str) -> String {
    url.rsplit('/').next().unwrap_or(url).to_string()
}

/// FIFO queues must have a `.fifo` suffix; append it when missing.
fn fifo_queue_name(name: &str, fifo: bool) -> String {
    if fifo && !name.ends_with(".fifo") {
        format!("{name}.fifo")
    } else {
        name.to_string()
    }
}

/// Look up a queue attribute as a string, if present.
fn attr_str(
    attrs: &HashMap<QueueAttributeName, String>,
    key: &QueueAttributeName,
) -> Option<String> {
    attrs.get(key).cloned()
}

/// Look up a numeric queue attribute, defaulting to 0 when absent/unparseable.
fn attr_i64(attrs: &HashMap<QueueAttributeName, String>, key: &QueueAttributeName) -> i64 {
    attrs
        .get(key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
}

/// Convert an epoch-seconds string (SQS `CreatedTimestamp`) into ISO8601.
fn epoch_secs_to_iso(attrs: &HashMap<QueueAttributeName, String>) -> Option<String> {
    let secs = attrs
        .get(&QueueAttributeName::CreatedTimestamp)?
        .parse::<i64>()
        .ok()?;
    DateTime::from_secs(secs).fmt(Format::DateTime).ok()
}

async fn get_attributes(
    client: &Client,
    queue_url: &str,
) -> Result<HashMap<QueueAttributeName, String>, AppError> {
    let out = client
        .get_queue_attributes()
        .queue_url(queue_url)
        .attribute_names(QueueAttributeName::All)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.attributes().cloned().unwrap_or_default())
}

pub async fn list_queues(client: &Client) -> Result<Vec<QueueSummary>, AppError> {
    let out = client.list_queues().send().await.map_err(map_sdk_err)?;
    let mut summaries = vec![];
    for url in out.queue_urls() {
        // Queue counts are small; a sequential GetQueueAttributes per queue is fine.
        // A queue can be deleted between ListQueues and this per-queue lookup
        // (NonExistentQueue -> AppError::NotFound); skip only that case rather
        // than failing the whole listing, and propagate every other error.
        let attrs = match get_attributes(client, url).await {
            Ok(a) => a,
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        };
        summaries.push(QueueSummary {
            queue_url: url.clone(),
            name: queue_name_from_url(url),
            fifo: attr_str(&attrs, &QueueAttributeName::FifoQueue).as_deref() == Some("true"),
            approximate_messages: attr_i64(
                &attrs,
                &QueueAttributeName::ApproximateNumberOfMessages,
            ),
            approximate_not_visible: attr_i64(
                &attrs,
                &QueueAttributeName::ApproximateNumberOfMessagesNotVisible,
            ),
        });
    }
    Ok(summaries)
}

pub async fn get_queue(client: &Client, queue_url: &str) -> Result<QueueDetail, AppError> {
    let attrs = get_attributes(client, queue_url).await?;
    Ok(QueueDetail {
        queue_url: queue_url.to_string(),
        name: queue_name_from_url(queue_url),
        fifo: attr_str(&attrs, &QueueAttributeName::FifoQueue).as_deref() == Some("true"),
        approximate_messages: attr_i64(&attrs, &QueueAttributeName::ApproximateNumberOfMessages),
        approximate_not_visible: attr_i64(
            &attrs,
            &QueueAttributeName::ApproximateNumberOfMessagesNotVisible,
        ),
        arn: attr_str(&attrs, &QueueAttributeName::QueueArn).unwrap_or_default(),
        visibility_timeout: attr_i64(&attrs, &QueueAttributeName::VisibilityTimeout),
        retention_period: attr_i64(&attrs, &QueueAttributeName::MessageRetentionPeriod),
        delay_seconds: attr_i64(&attrs, &QueueAttributeName::DelaySeconds),
        max_message_size: attr_i64(&attrs, &QueueAttributeName::MaximumMessageSize),
        redrive_policy: attr_str(&attrs, &QueueAttributeName::RedrivePolicy),
        created_at: epoch_secs_to_iso(&attrs),
    })
}

pub async fn create_queue(client: &Client, req: &CreateQueueRequest) -> Result<(), AppError> {
    let name = fifo_queue_name(&req.name, req.fifo);
    let mut op = client.create_queue().queue_name(&name);
    if req.fifo {
        op = op.attributes(QueueAttributeName::FifoQueue, "true");
    }
    if let Some(v) = req.visibility_timeout {
        op = op.attributes(QueueAttributeName::VisibilityTimeout, v.to_string());
    }
    if let Some(v) = req.retention_period {
        op = op.attributes(QueueAttributeName::MessageRetentionPeriod, v.to_string());
    }
    if let Some(v) = req.delay_seconds {
        op = op.attributes(QueueAttributeName::DelaySeconds, v.to_string());
    }
    if let Some(v) = &req.redrive_policy {
        if !v.trim().is_empty() {
            op = op.attributes(QueueAttributeName::RedrivePolicy, v);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_queue(client: &Client, queue_url: &str) -> Result<(), AppError> {
    client
        .delete_queue()
        .queue_url(queue_url)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn set_queue_attributes(
    client: &Client,
    queue_url: &str,
    req: &QueueAttributesUpdate,
) -> Result<(), AppError> {
    let mut op = client
        .set_queue_attributes()
        .queue_url(queue_url)
        .attributes(
            QueueAttributeName::VisibilityTimeout,
            req.visibility_timeout.to_string(),
        )
        .attributes(
            QueueAttributeName::MessageRetentionPeriod,
            req.retention_period.to_string(),
        )
        .attributes(
            QueueAttributeName::DelaySeconds,
            req.delay_seconds.to_string(),
        );
    if let Some(v) = &req.redrive_policy {
        if !v.trim().is_empty() {
            op = op.attributes(QueueAttributeName::RedrivePolicy, v);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn send_message(
    client: &Client,
    queue_url: &str,
    req: &SendMessageRequest,
) -> Result<(), AppError> {
    let mut op = client
        .send_message()
        .queue_url(queue_url)
        .message_body(&req.body);
    if let Some(v) = req.delay_seconds {
        op = op.delay_seconds(v as i32);
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
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn receive_messages(
    client: &Client,
    queue_url: &str,
) -> Result<Vec<SqsMessage>, AppError> {
    let out = client
        .receive_message()
        .queue_url(queue_url)
        .max_number_of_messages(10)
        .visibility_timeout(30)
        .wait_time_seconds(1)
        .message_system_attribute_names(MessageSystemAttributeName::All)
        .message_attribute_names("All")
        .send()
        .await
        .map_err(map_sdk_err)?;
    let messages = out
        .messages()
        .iter()
        .map(|m| {
            let attributes = m
                .message_attributes()
                .map(|attrs| {
                    let map: serde_json::Map<String, Value> = attrs
                        .iter()
                        .map(|(k, v)| {
                            (
                                k.clone(),
                                serde_json::json!({
                                    "dataType": v.data_type(),
                                    "stringValue": v.string_value().unwrap_or_default(),
                                }),
                            )
                        })
                        .collect();
                    Value::Object(map)
                })
                .unwrap_or(Value::Object(serde_json::Map::new()));
            let sent_at = m
                .attributes()
                .and_then(|a| a.get(&MessageSystemAttributeName::SentTimestamp))
                .and_then(|s| s.parse::<i64>().ok())
                .and_then(|millis| DateTime::from_millis(millis).fmt(Format::DateTime).ok());
            SqsMessage {
                message_id: m.message_id().unwrap_or_default().to_string(),
                receipt_handle: m.receipt_handle().unwrap_or_default().to_string(),
                body: m.body().unwrap_or_default().to_string(),
                attributes,
                sent_at,
            }
        })
        .collect();
    Ok(messages)
}

pub async fn delete_message(
    client: &Client,
    queue_url: &str,
    receipt_handle: &str,
) -> Result<(), AppError> {
    client
        .delete_message()
        .queue_url(queue_url)
        .receipt_handle(receipt_handle)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn purge_queue(client: &Client, queue_url: &str) -> Result<(), AppError> {
    client
        .purge_queue()
        .queue_url(queue_url)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

/// Mirror of the frontend `isUnsupportedOperation` signature check: true when an
/// error message looks like the emulator does not implement the operation.
/// ministack reports ListDeadLetterSourceQueues as "The action
/// ListDeadLetterSourceQueues is not valid for this endpoint".
fn is_unsupported_msg(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("unknownoperation")
        || m.contains("unknown operation")
        || m.contains("not supported")
        || m.contains("not yet implemented")
        || m.contains("pro feature")
        || m.contains("is not valid")
}

pub async fn list_queue_tags(client: &Client, queue_url: &str) -> Result<Vec<QueueTag>, AppError> {
    let out = client
        .list_queue_tags()
        .queue_url(queue_url)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut tags: Vec<QueueTag> = out
        .tags()
        .map(|m| {
            m.iter()
                .map(|(k, v)| QueueTag {
                    key: k.clone(),
                    value: v.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(tags)
}

pub async fn tag_queue(
    client: &Client,
    queue_url: &str,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    client
        .tag_queue()
        .queue_url(queue_url)
        .tags(key, value)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn untag_queue(client: &Client, queue_url: &str, key: &str) -> Result<(), AppError> {
    client
        .untag_queue()
        .queue_url(queue_url)
        .tag_keys(key)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_dlq_sources(client: &Client, queue_url: &str) -> Result<DlqSourceInfo, AppError> {
    let attrs = get_attributes(client, queue_url).await?;
    let redrive_policy = attr_str(&attrs, &QueueAttributeName::RedrivePolicy);

    match client
        .list_dead_letter_source_queues()
        .queue_url(queue_url)
        .send()
        .await
    {
        Ok(out) => {
            let sources = out
                .queue_urls()
                .iter()
                .map(|u| queue_name_from_url(u))
                .collect();
            Ok(DlqSourceInfo {
                redrive_policy,
                sources,
                supported: true,
            })
        }
        Err(e) => {
            let err = map_sdk_err(e);
            if is_unsupported_msg(&err.to_string()) {
                Ok(DlqSourceInfo {
                    redrive_policy,
                    sources: vec![],
                    supported: false,
                })
            } else {
                Err(err)
            }
        }
    }
}

fn client_for(profile: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(profile))
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_list_queues(profile: ConnectionProfile) -> Result<Vec<QueueSummary>, AppError> {
    list_queues(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_get_queue(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<QueueDetail, AppError> {
    get_queue(&client_for(&profile), &queue_url).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_create_queue(
    profile: ConnectionProfile,
    req: CreateQueueRequest,
) -> Result<(), AppError> {
    create_queue(&client_for(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_delete_queue(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<(), AppError> {
    delete_queue(&client_for(&profile), &queue_url).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_set_queue_attributes(
    profile: ConnectionProfile,
    queue_url: String,
    req: QueueAttributesUpdate,
) -> Result<(), AppError> {
    set_queue_attributes(&client_for(&profile), &queue_url, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_send_message(
    profile: ConnectionProfile,
    queue_url: String,
    req: SendMessageRequest,
) -> Result<(), AppError> {
    send_message(&client_for(&profile), &queue_url, &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_receive_messages(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<Vec<SqsMessage>, AppError> {
    receive_messages(&client_for(&profile), &queue_url).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_delete_message(
    profile: ConnectionProfile,
    queue_url: String,
    receipt_handle: String,
) -> Result<(), AppError> {
    delete_message(&client_for(&profile), &queue_url, &receipt_handle).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_purge_queue(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<(), AppError> {
    purge_queue(&client_for(&profile), &queue_url).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_list_queue_tags(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<Vec<QueueTag>, AppError> {
    list_queue_tags(&client_for(&profile), &queue_url).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_tag_queue(
    profile: ConnectionProfile,
    queue_url: String,
    key: String,
    value: String,
) -> Result<(), AppError> {
    tag_queue(&client_for(&profile), &queue_url, &key, &value).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_untag_queue(
    profile: ConnectionProfile,
    queue_url: String,
    key: String,
) -> Result<(), AppError> {
    untag_queue(&client_for(&profile), &queue_url, &key).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sqs_list_dlq_sources(
    profile: ConnectionProfile,
    queue_url: String,
) -> Result<DlqSourceInfo, AppError> {
    list_dlq_sources(&client_for(&profile), &queue_url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_name_is_last_url_segment() {
        assert_eq!(
            queue_name_from_url("http://localhost:4566/000000000000/my-queue"),
            "my-queue"
        );
        assert_eq!(
            queue_name_from_url("http://localhost:4566/000000000000/orders.fifo"),
            "orders.fifo"
        );
        assert_eq!(queue_name_from_url("plain"), "plain");
    }

    #[test]
    fn fifo_name_appends_suffix_only_when_needed() {
        assert_eq!(fifo_queue_name("orders", true), "orders.fifo");
        assert_eq!(fifo_queue_name("orders.fifo", true), "orders.fifo");
        assert_eq!(fifo_queue_name("orders", false), "orders");
    }

    #[test]
    fn queue_summary_serializes_camel_case() {
        let s = QueueSummary {
            queue_url: "http://localhost/q".into(),
            name: "q".into(),
            fifo: true,
            approximate_messages: 3,
            approximate_not_visible: 1,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["queueUrl"], "http://localhost/q");
        assert_eq!(v["name"], "q");
        assert_eq!(v["fifo"], true);
        assert_eq!(v["approximateMessages"], 3);
        assert_eq!(v["approximateNotVisible"], 1);
    }

    #[test]
    fn queue_detail_serializes_camel_case() {
        let d = QueueDetail {
            queue_url: "http://localhost/q".into(),
            name: "q".into(),
            fifo: false,
            approximate_messages: 0,
            approximate_not_visible: 0,
            arn: "arn:aws:sqs:...:q".into(),
            visibility_timeout: 30,
            retention_period: 345600,
            delay_seconds: 0,
            max_message_size: 262144,
            redrive_policy: None,
            created_at: Some("2026-07-14T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["arn"], "arn:aws:sqs:...:q");
        assert_eq!(v["visibilityTimeout"], 30);
        assert_eq!(v["retentionPeriod"], 345600);
        assert_eq!(v["delaySeconds"], 0);
        assert_eq!(v["maxMessageSize"], 262144);
        assert_eq!(v["redrivePolicy"], Value::Null);
        assert_eq!(v["createdAt"], "2026-07-14T00:00:00Z");
    }

    #[test]
    fn queue_tag_serializes_camel_case() {
        let t = QueueTag {
            key: "env".into(),
            value: "prod".into(),
        };
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["key"], "env");
        assert_eq!(v["value"], "prod");
    }

    #[test]
    fn dlq_source_info_serializes_camel_case() {
        let info = DlqSourceInfo {
            redrive_policy: Some("{\"maxReceiveCount\":3}".into()),
            sources: vec!["src-queue".into()],
            supported: true,
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["redrivePolicy"], "{\"maxReceiveCount\":3}");
        assert_eq!(v["sources"][0], "src-queue");
        assert_eq!(v["supported"], true);
    }

    #[test]
    fn detects_unsupported_operation_signatures() {
        assert!(is_unsupported_msg(
            "internal error: InvalidAction: The action ListDeadLetterSourceQueues is not valid for this endpoint"
        ));
        assert!(is_unsupported_msg("UnknownOperationException"));
        assert!(is_unsupported_msg("This action is not supported"));
        assert!(is_unsupported_msg(
            "API for service 'x' not yet implemented or pro feature"
        ));
        assert!(!is_unsupported_msg("not found: no such queue"));
    }

    #[test]
    fn send_request_deserializes_camel_case() {
        let json = serde_json::json!({
            "body": "hello",
            "delaySeconds": 5,
            "groupId": "g1",
            "dedupId": "d1",
            "attributes": { "k": { "dataType": "String", "stringValue": "v" } }
        });
        let req: SendMessageRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.body, "hello");
        assert_eq!(req.delay_seconds, Some(5));
        assert_eq!(req.group_id.as_deref(), Some("g1"));
        assert_eq!(req.dedup_id.as_deref(), Some("d1"));
        let attrs = req.attributes.unwrap();
        assert_eq!(attrs["k"].data_type, "String");
        assert_eq!(attrs["k"].string_value, "v");
    }
}
