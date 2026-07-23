use aws_sdk_secretsmanager::Client;
use aws_smithy_types::{date_time::Format, DateTime};
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSummary {
    pub name: String,
    pub arn: String,
    pub description: Option<String>,
    pub last_changed_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretTag {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretDetail {
    pub name: String,
    pub arn: String,
    pub description: Option<String>,
    pub created_date: Option<String>,
    pub last_changed_date: Option<String>,
    pub tags: Vec<SecretTag>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretValue {
    pub secret_string: Option<String>,
    pub version_id: Option<String>,
    pub created_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretVersion {
    pub version_id: String,
    pub stages: Vec<String>,
    pub created_date: Option<String>,
}

/// Format an optional SDK timestamp as ISO8601, dropping unrepresentable values.
fn fmt_date(dt: Option<&DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

/// Mirror of the frontend `isUnsupportedOperation` check: true when an error
/// message looks like the emulator does not implement the operation (e.g. kumo
/// answers ListSecretVersionIds / TagResource with "is not valid").
fn is_unsupported_msg(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("unknownoperation")
        || m.contains("unknown operation")
        || m.contains("not supported")
        || m.contains("not yet implemented")
        || m.contains("pro feature")
        || m.contains("is not valid")
        || m.contains("invalidaction")
}

pub async fn list_secrets(client: &Client) -> Result<Vec<SecretSummary>, AppError> {
    let mut secrets = vec![];
    let mut next_token: Option<String> = None;
    loop {
        let out = client
            .list_secrets()
            .set_next_token(next_token.clone())
            .send()
            .await
            .map_err(map_sdk_err)?;
        for s in out.secret_list() {
            secrets.push(SecretSummary {
                name: s.name().unwrap_or_default().to_string(),
                arn: s.arn().unwrap_or_default().to_string(),
                description: s.description().map(|d| d.to_string()),
                last_changed_date: fmt_date(s.last_changed_date()),
            });
        }
        next_token = out.next_token().map(|t| t.to_string());
        if next_token.is_none() {
            break;
        }
    }
    secrets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(secrets)
}

pub async fn create_secret(
    client: &Client,
    name: &str,
    secret_string: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    let mut op = client
        .create_secret()
        .name(name)
        .secret_string(secret_string);
    if let Some(d) = description {
        if !d.is_empty() {
            op = op.description(d);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn describe_secret(client: &Client, id: &str) -> Result<SecretDetail, AppError> {
    let out = client
        .describe_secret()
        .secret_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut tags: Vec<SecretTag> = out
        .tags()
        .iter()
        .map(|t| SecretTag {
            key: t.key().unwrap_or_default().to_string(),
            value: t.value().unwrap_or_default().to_string(),
        })
        .collect();
    tags.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(SecretDetail {
        name: out.name().unwrap_or_default().to_string(),
        arn: out.arn().unwrap_or_default().to_string(),
        description: out.description().map(|d| d.to_string()),
        created_date: fmt_date(out.created_date()),
        last_changed_date: fmt_date(out.last_changed_date()),
        tags,
    })
}

pub async fn get_secret_value(client: &Client, id: &str) -> Result<SecretValue, AppError> {
    let out = client
        .get_secret_value()
        .secret_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(SecretValue {
        secret_string: out.secret_string().map(|s| s.to_string()),
        version_id: out.version_id().map(|v| v.to_string()),
        created_date: fmt_date(out.created_date()),
    })
}

pub async fn put_secret_value(
    client: &Client,
    id: &str,
    secret_string: &str,
) -> Result<(), AppError> {
    client
        .put_secret_value()
        .secret_id(id)
        .secret_string(secret_string)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

/// List a secret's versions and their staging labels. Some emulators (kumo)
/// do not implement ListSecretVersionIds; fall back to DescribeSecret's
/// VersionIdsToStages so the version table renders everywhere.
pub async fn list_secret_versions(
    client: &Client,
    id: &str,
) -> Result<Vec<SecretVersion>, AppError> {
    match client.list_secret_version_ids().secret_id(id).send().await {
        Ok(out) => {
            let mut versions: Vec<SecretVersion> = out
                .versions()
                .iter()
                .map(|v| SecretVersion {
                    version_id: v.version_id().unwrap_or_default().to_string(),
                    stages: v.version_stages().to_vec(),
                    created_date: fmt_date(v.created_date()),
                })
                .collect();
            versions.sort_by(|a, b| a.version_id.cmp(&b.version_id));
            Ok(versions)
        }
        Err(e) => {
            let err = map_sdk_err(e);
            if is_unsupported_msg(&err.to_string()) {
                versions_from_describe(client, id).await
            } else {
                Err(err)
            }
        }
    }
}

/// Build the version list from DescribeSecret (works on emulators without
/// ListSecretVersionIds). Per-version created dates are unavailable this way.
async fn versions_from_describe(client: &Client, id: &str) -> Result<Vec<SecretVersion>, AppError> {
    let out = client
        .describe_secret()
        .secret_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let mut versions: Vec<SecretVersion> = out
        .version_ids_to_stages()
        .map(|m| {
            m.iter()
                .map(|(version_id, stages)| SecretVersion {
                    version_id: version_id.clone(),
                    stages: stages.clone(),
                    created_date: None,
                })
                .collect()
        })
        .unwrap_or_default();
    versions.sort_by(|a, b| a.version_id.cmp(&b.version_id));
    Ok(versions)
}

pub async fn delete_secret(
    client: &Client,
    id: &str,
    force: bool,
    recovery_days: Option<i64>,
) -> Result<(), AppError> {
    let mut op = client.delete_secret().secret_id(id);
    if force {
        // ForceDeleteWithoutRecovery and RecoveryWindowInDays are mutually
        // exclusive; when forcing, never set a recovery window.
        op = op.force_delete_without_recovery(true);
    } else if let Some(days) = recovery_days {
        op = op.recovery_window_in_days(days);
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn tag_secret(client: &Client, id: &str, key: &str, value: &str) -> Result<(), AppError> {
    let tag = aws_sdk_secretsmanager::types::Tag::builder()
        .key(key)
        .value(value)
        .build();
    client
        .tag_resource()
        .secret_id(id)
        .tags(tag)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn untag_secret(client: &Client, id: &str, key: &str) -> Result<(), AppError> {
    client
        .untag_resource()
        .secret_id(id)
        .tag_keys(key)
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
pub async fn secrets_list(profile: ConnectionProfile) -> Result<Vec<SecretSummary>, AppError> {
    list_secrets(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_create(
    profile: ConnectionProfile,
    name: String,
    secret_string: String,
    description: Option<String>,
) -> Result<(), AppError> {
    create_secret(
        &client_for(&profile),
        &name,
        &secret_string,
        description.as_deref(),
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_describe(
    profile: ConnectionProfile,
    id: String,
) -> Result<SecretDetail, AppError> {
    describe_secret(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_get_value(
    profile: ConnectionProfile,
    id: String,
) -> Result<SecretValue, AppError> {
    get_secret_value(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_put_value(
    profile: ConnectionProfile,
    id: String,
    secret_string: String,
) -> Result<(), AppError> {
    put_secret_value(&client_for(&profile), &id, &secret_string).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_list_versions(
    profile: ConnectionProfile,
    id: String,
) -> Result<Vec<SecretVersion>, AppError> {
    list_secret_versions(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_delete(
    profile: ConnectionProfile,
    id: String,
    force: bool,
    recovery_days: Option<i64>,
) -> Result<(), AppError> {
    delete_secret(&client_for(&profile), &id, force, recovery_days).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_tag(
    profile: ConnectionProfile,
    id: String,
    key: String,
    value: String,
) -> Result<(), AppError> {
    tag_secret(&client_for(&profile), &id, &key, &value).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn secrets_untag(
    profile: ConnectionProfile,
    id: String,
    key: String,
) -> Result<(), AppError> {
    untag_secret(&client_for(&profile), &id, &key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_summary_serializes_camel_case() {
        let s = SecretSummary {
            name: "db/creds".into(),
            arn: "arn:aws:secretsmanager:...:db/creds".into(),
            description: Some("prod db".into()),
            last_changed_date: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "db/creds");
        assert_eq!(v["arn"], "arn:aws:secretsmanager:...:db/creds");
        assert_eq!(v["description"], "prod db");
        assert_eq!(v["lastChangedDate"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn secret_detail_serializes_camel_case() {
        let d = SecretDetail {
            name: "s".into(),
            arn: "arn".into(),
            description: None,
            created_date: Some("2026-07-01T00:00:00Z".into()),
            last_changed_date: None,
            tags: vec![SecretTag {
                key: "env".into(),
                value: "prod".into(),
            }],
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["createdDate"], "2026-07-01T00:00:00Z");
        assert_eq!(v["lastChangedDate"], serde_json::Value::Null);
        assert_eq!(v["description"], serde_json::Value::Null);
        assert_eq!(v["tags"][0]["key"], "env");
        assert_eq!(v["tags"][0]["value"], "prod");
    }

    #[test]
    fn secret_value_serializes_camel_case() {
        let val = SecretValue {
            secret_string: Some("{\"k\":\"v\"}".into()),
            version_id: Some("v-1".into()),
            created_date: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&val).unwrap();
        assert_eq!(v["secretString"], "{\"k\":\"v\"}");
        assert_eq!(v["versionId"], "v-1");
        assert_eq!(v["createdDate"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn secret_version_serializes_camel_case() {
        let ver = SecretVersion {
            version_id: "v-1".into(),
            stages: vec!["AWSCURRENT".into()],
            created_date: None,
        };
        let v = serde_json::to_value(&ver).unwrap();
        assert_eq!(v["versionId"], "v-1");
        assert_eq!(v["stages"][0], "AWSCURRENT");
        assert_eq!(v["createdDate"], serde_json::Value::Null);
    }

    #[test]
    fn detects_unsupported_operation_signatures() {
        assert!(is_unsupported_msg(
            "internal error: InvalidAction: The action ListSecretVersionIds is not valid"
        ));
        assert!(is_unsupported_msg("UnknownOperationException"));
        assert!(is_unsupported_msg("This action is not supported"));
        assert!(is_unsupported_msg("pro feature"));
        assert!(!is_unsupported_msg("not found: no such secret"));
    }
}
