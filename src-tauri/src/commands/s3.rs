use std::collections::HashMap;

use aws_sdk_s3::primitives::{ByteStream, DateTimeFormat};
use aws_sdk_s3::types::{BucketLocationConstraint, CreateBucketConfiguration};
use aws_sdk_s3::Client;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketSummary {
    pub name: String,
    /// RFC3339 timestamp of when the bucket was created.
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSummary {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    pub prefixes: Vec<String>,
    pub objects: Vec<ObjectSummary>,
    pub next_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDetail {
    pub key: String,
    pub size: i64,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub metadata: HashMap<String, String>,
}

/// Build an S3 client. Local emulators (LocalStack / ministack / floci) require
/// path-style addressing because virtual-host-style buckets are not resolvable
/// against `localhost`.
fn make_client(p: &ConnectionProfile) -> Client {
    let config = aws_sdk_s3::config::Builder::from(&make_sdk_config(p))
        .force_path_style(true)
        .build();
    Client::from_conf(config)
}

fn fmt_dt(dt: Option<&aws_sdk_s3::primitives::DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(DateTimeFormat::DateTime).ok())
}

pub async fn list_buckets(client: &Client) -> Result<Vec<BucketSummary>, AppError> {
    let out = client.list_buckets().send().await.map_err(map_sdk_err)?;
    Ok(out
        .buckets()
        .iter()
        .map(|b| BucketSummary {
            name: b.name().unwrap_or_default().to_string(),
            created_at: fmt_dt(b.creation_date()),
        })
        .collect())
}

pub async fn create_bucket(client: &Client, name: &str, region: &str) -> Result<(), AppError> {
    let mut op = client.create_bucket().bucket(name);
    // us-east-1 must NOT carry a LocationConstraint; every other region must.
    if region != "us-east-1" {
        op = op.create_bucket_configuration(
            CreateBucketConfiguration::builder()
                .location_constraint(BucketLocationConstraint::from(region))
                .build(),
        );
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bucket(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_bucket()
        .bucket(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_objects(
    client: &Client,
    bucket: &str,
    prefix: &str,
    next_token: Option<String>,
) -> Result<ObjectPage, AppError> {
    let out = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(prefix)
        .delimiter("/")
        .max_keys(100)
        .set_continuation_token(next_token)
        .send()
        .await
        .map_err(map_sdk_err)?;

    let prefixes = out
        .common_prefixes()
        .iter()
        .filter_map(|p| p.prefix().map(String::from))
        .collect();

    let objects = out
        .contents()
        .iter()
        // Skip the zero-byte marker object whose key is the prefix itself
        // (a "folder" placeholder), so it is not listed as a real object.
        .filter(|o| o.key() != Some(prefix))
        .map(|o| ObjectSummary {
            key: o.key().unwrap_or_default().to_string(),
            size: o.size().unwrap_or(0),
            last_modified: fmt_dt(o.last_modified()),
        })
        .collect();

    Ok(ObjectPage {
        prefixes,
        objects,
        next_token: out.next_continuation_token().map(String::from),
    })
}

pub async fn head_object(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Result<ObjectDetail, AppError> {
    let out = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(ObjectDetail {
        key: key.to_string(),
        size: out.content_length().unwrap_or(0),
        content_type: out.content_type().map(String::from),
        etag: out.e_tag().map(String::from),
        last_modified: fmt_dt(out.last_modified()),
        metadata: out.metadata().cloned().unwrap_or_default(),
    })
}

pub async fn put_object(
    client: &Client,
    bucket: &str,
    key: &str,
    body_base64: &str,
    content_type: Option<String>,
) -> Result<(), AppError> {
    let bytes = B64
        .decode(body_base64)
        .map_err(|e| AppError::Validation(format!("invalid base64 body: {e}")))?;
    let mut op = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(bytes));
    if let Some(ct) = content_type {
        op = op.content_type(ct);
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn download_object(
    client: &Client,
    bucket: &str,
    key: &str,
    dest_path: &str,
) -> Result<(), AppError> {
    let out = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let data = out
        .body
        .collect()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    std::fs::write(dest_path, data.into_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}

pub async fn delete_object(client: &Client, bucket: &str, key: &str) -> Result<(), AppError> {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_list_buckets(profile: ConnectionProfile) -> Result<Vec<BucketSummary>, AppError> {
    list_buckets(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_create_bucket(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    let region = profile.region.clone();
    create_bucket(&make_client(&profile), &name, &region).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_delete_bucket(profile: ConnectionProfile, name: String) -> Result<(), AppError> {
    delete_bucket(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_list_objects(
    profile: ConnectionProfile,
    bucket: String,
    prefix: String,
    next_token: Option<String>,
) -> Result<ObjectPage, AppError> {
    list_objects(&make_client(&profile), &bucket, &prefix, next_token).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_head_object(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
) -> Result<ObjectDetail, AppError> {
    head_object(&make_client(&profile), &bucket, &key).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_put_object(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
    body_base64: String,
    content_type: Option<String>,
) -> Result<(), AppError> {
    put_object(
        &make_client(&profile),
        &bucket,
        &key,
        &body_base64,
        content_type,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_download_object(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
    dest_path: String,
) -> Result<(), AppError> {
    download_object(&make_client(&profile), &bucket, &key, &dest_path).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_delete_object(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
) -> Result<(), AppError> {
    delete_object(&make_client(&profile), &bucket, &key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_summary_serializes_camel_case() {
        let b = BucketSummary {
            name: "my-bucket".into(),
            created_at: Some("2026-07-14T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["name"], "my-bucket");
        assert_eq!(v["createdAt"], "2026-07-14T00:00:00Z");
    }

    #[test]
    fn object_summary_serializes_camel_case() {
        let o = ObjectSummary {
            key: "a/b.txt".into(),
            size: 42,
            last_modified: Some("2026-07-14T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&o).unwrap();
        assert_eq!(v["key"], "a/b.txt");
        assert_eq!(v["size"], 42);
        assert_eq!(v["lastModified"], "2026-07-14T00:00:00Z");
    }

    #[test]
    fn object_page_serializes_camel_case() {
        let p = ObjectPage {
            prefixes: vec!["a/".into()],
            objects: vec![],
            next_token: Some("tok".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["prefixes"][0], "a/");
        assert!(v["objects"].as_array().unwrap().is_empty());
        assert_eq!(v["nextToken"], "tok");
    }

    #[test]
    fn object_detail_serializes_camel_case() {
        let mut metadata = HashMap::new();
        metadata.insert("owner".to_string(), "alice".to_string());
        let d = ObjectDetail {
            key: "a.txt".into(),
            size: 10,
            content_type: Some("text/plain".into()),
            etag: Some("\"abc\"".into()),
            last_modified: Some("2026-07-14T00:00:00Z".into()),
            metadata,
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["key"], "a.txt");
        assert_eq!(v["size"], 10);
        assert_eq!(v["contentType"], "text/plain");
        assert_eq!(v["etag"], "\"abc\"");
        assert_eq!(v["lastModified"], "2026-07-14T00:00:00Z");
        assert_eq!(v["metadata"]["owner"], "alice");
    }
}
