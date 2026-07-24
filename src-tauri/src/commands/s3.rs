use std::collections::HashMap;

use aws_sdk_s3::primitives::{ByteStream, DateTimeFormat, Length};
use aws_sdk_s3::types::{
    BucketLocationConstraint, BucketVersioningStatus, CompletedMultipartUpload, CompletedPart,
    CorsConfiguration, CorsRule, CreateBucketConfiguration, Tag, Tagging, VersioningConfiguration,
};
use aws_sdk_s3::Client;
use aws_smithy_types::error::metadata::ProvideErrorMetadata;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

/// Multipart chunk size: 8 MiB. Files at or below this go through a single
/// `put_object`; larger files are uploaded as multipart with 8 MiB parts.
const CHUNK_SIZE: u64 = 8 * 1024 * 1024;

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

/// A single S3 tag as a key/value pair (round-trips to the UI as `{key, value}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagKv {
    pub key: String,
    pub value: String,
}

/// Aggregated bucket properties: versioning status, tags, CORS and policy.
/// Unset configuration comes back as `null`/empty rather than an error.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketProperties {
    /// "Enabled" / "Suspended", or `None` when versioning was never configured.
    pub versioning: Option<String>,
    pub tags: Vec<TagKv>,
    /// CORS rules serialized as a JSON string, or `None` when unset.
    pub cors_json: Option<String>,
    /// Bucket policy JSON string, or `None` when unset.
    pub policy_json: Option<String>,
}

/// One object version (or delete marker) returned by ListObjectVersions.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectVersion {
    pub key: String,
    pub version_id: String,
    pub is_latest: bool,
    pub delete_marker: bool,
    pub size: Option<i64>,
    pub last_modified: Option<String>,
}

/// Serde mirror of an S3 CORS rule for lossless JSON round-tripping in the UI.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorsRuleJson {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub allowed_methods: Vec<String>,
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub allowed_headers: Vec<String>,
    #[serde(default)]
    pub expose_headers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_age_seconds: Option<i32>,
}

/// Build an S3 client. Local emulators (LocalStack / ministack / floci) require
/// path-style addressing because virtual-host-style buckets are not resolvable
/// against `localhost`. Checksums are computed only when an operation requires
/// them: the SDK's default (WhenSupported) sends uploads as `aws-chunked`
/// streams with CRC trailers, which some emulators (kumo) store verbatim —
/// corrupting the object body with chunk-signature framing.
fn make_client(p: &ConnectionProfile) -> Client {
    let config = aws_sdk_s3::config::Builder::from(&make_sdk_config(p))
        .force_path_style(true)
        .request_checksum_calculation(aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired)
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

/// Whether a file of `total` bytes must use multipart upload for the given
/// chunk size. A file exactly `chunk` bytes stays a single `put_object`;
/// `chunk + 1` bytes crosses into multipart.
fn use_multipart(total: u64, chunk: u64) -> bool {
    total > chunk
}

/// Split `[0, total)` into consecutive `(offset, len)` ranges of at most
/// `chunk` bytes each. Used to plan multipart parts.
fn split_ranges(total: u64, chunk: u64) -> Vec<(u64, u64)> {
    let mut ranges = Vec::new();
    let mut offset = 0u64;
    while offset < total {
        let len = std::cmp::min(chunk, total - offset);
        ranges.push((offset, len));
        offset += len;
    }
    ranges
}

/// Guess a Content-Type from the key's file extension. Deliberately a small
/// hand-maintained table (no `mime_guess` dependency); unknown → octet-stream.
fn guess_content_type(key: &str) -> &'static str {
    let ext = key
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "txt" | "text" | "log" => "text/plain",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "csv" => "text/csv",
        "xml" => "application/xml",
        "md" => "text/markdown",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        _ => "application/octet-stream",
    }
}

/// Convert SDK CORS rules to the JSON string the UI edits.
fn cors_rules_to_json(rules: &[CorsRule]) -> Result<String, AppError> {
    let json: Vec<CorsRuleJson> = rules
        .iter()
        .map(|r| CorsRuleJson {
            id: r.id().map(String::from),
            allowed_methods: r.allowed_methods().to_vec(),
            allowed_origins: r.allowed_origins().to_vec(),
            allowed_headers: r.allowed_headers().to_vec(),
            expose_headers: r.expose_headers().to_vec(),
            max_age_seconds: r.max_age_seconds(),
        })
        .collect();
    serde_json::to_string_pretty(&json).map_err(|e| AppError::Internal(e.to_string()))
}

/// Parse the UI's CORS JSON string into SDK CORS rules.
fn json_to_cors_rules(cors_json: &str) -> Result<Vec<CorsRule>, AppError> {
    let parsed: Vec<CorsRuleJson> = serde_json::from_str(cors_json)
        .map_err(|e| AppError::Validation(format!("invalid CORS JSON: {e}")))?;
    parsed
        .into_iter()
        .map(|r| {
            let mut b = CorsRule::builder()
                .set_allowed_methods(Some(r.allowed_methods))
                .set_allowed_origins(Some(r.allowed_origins));
            if !r.allowed_headers.is_empty() {
                b = b.set_allowed_headers(Some(r.allowed_headers));
            }
            if !r.expose_headers.is_empty() {
                b = b.set_expose_headers(Some(r.expose_headers));
            }
            if let Some(id) = r.id {
                b = b.id(id);
            }
            if let Some(max_age) = r.max_age_seconds {
                b = b.max_age_seconds(max_age);
            }
            b.build().map_err(|e| AppError::Validation(e.to_string()))
        })
        .collect()
}

pub async fn get_bucket_properties(
    client: &Client,
    bucket: &str,
) -> Result<BucketProperties, AppError> {
    let versioning = client
        .get_bucket_versioning()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?
        .status()
        .map(|s| s.as_str().to_string());

    let tags = match client.get_bucket_tagging().bucket(bucket).send().await {
        Ok(out) => out
            .tag_set()
            .iter()
            .map(|t| TagKv {
                key: t.key().to_string(),
                value: t.value().to_string(),
            })
            .collect(),
        Err(e) if e.code() == Some("NoSuchTagSet") => Vec::new(),
        Err(e) => return Err(map_sdk_err(e)),
    };

    let cors_json = match client.get_bucket_cors().bucket(bucket).send().await {
        Ok(out) => Some(cors_rules_to_json(out.cors_rules())?),
        Err(e) if e.code() == Some("NoSuchCORSConfiguration") => None,
        Err(e) => return Err(map_sdk_err(e)),
    };

    let policy_json = match client.get_bucket_policy().bucket(bucket).send().await {
        Ok(out) => out.policy().map(String::from),
        Err(e) if e.code() == Some("NoSuchBucketPolicy") => None,
        Err(e) => return Err(map_sdk_err(e)),
    };

    Ok(BucketProperties {
        versioning,
        tags,
        cors_json,
        policy_json,
    })
}

pub async fn set_versioning(client: &Client, bucket: &str, enabled: bool) -> Result<(), AppError> {
    let status = if enabled {
        BucketVersioningStatus::Enabled
    } else {
        BucketVersioningStatus::Suspended
    };
    client
        .put_bucket_versioning()
        .bucket(bucket)
        .versioning_configuration(VersioningConfiguration::builder().status(status).build())
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn put_bucket_tagging(
    client: &Client,
    bucket: &str,
    tags: Vec<TagKv>,
) -> Result<(), AppError> {
    let tag_set = tags
        .into_iter()
        .map(|t| {
            Tag::builder()
                .key(t.key)
                .value(t.value)
                .build()
                .map_err(|e| AppError::Validation(e.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let tagging = Tagging::builder()
        .set_tag_set(Some(tag_set))
        .build()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    client
        .put_bucket_tagging()
        .bucket(bucket)
        .tagging(tagging)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn put_bucket_cors(
    client: &Client,
    bucket: &str,
    cors_json: &str,
) -> Result<(), AppError> {
    let rules = json_to_cors_rules(cors_json)?;
    let config = CorsConfiguration::builder()
        .set_cors_rules(Some(rules))
        .build()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    client
        .put_bucket_cors()
        .bucket(bucket)
        .cors_configuration(config)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn put_bucket_policy(
    client: &Client,
    bucket: &str,
    policy_json: &str,
) -> Result<(), AppError> {
    client
        .put_bucket_policy()
        .bucket(bucket)
        .policy(policy_json)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_object_versions(
    client: &Client,
    bucket: &str,
    prefix: &str,
) -> Result<Vec<ObjectVersion>, AppError> {
    let out = client
        .list_object_versions()
        .bucket(bucket)
        .prefix(prefix)
        .send()
        .await
        .map_err(map_sdk_err)?;

    let mut versions: Vec<ObjectVersion> = out
        .versions()
        .iter()
        .map(|v| ObjectVersion {
            key: v.key().unwrap_or_default().to_string(),
            version_id: v.version_id().unwrap_or_default().to_string(),
            is_latest: v.is_latest().unwrap_or(false),
            delete_marker: false,
            size: v.size(),
            last_modified: fmt_dt(v.last_modified()),
        })
        .collect();

    versions.extend(out.delete_markers().iter().map(|d| ObjectVersion {
        key: d.key().unwrap_or_default().to_string(),
        version_id: d.version_id().unwrap_or_default().to_string(),
        is_latest: d.is_latest().unwrap_or(false),
        delete_marker: true,
        size: None,
        last_modified: fmt_dt(d.last_modified()),
    }));

    Ok(versions)
}

pub async fn download_object_version(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: &str,
    dest_path: &str,
) -> Result<(), AppError> {
    let out = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .version_id(version_id)
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

pub async fn copy_object(
    client: &Client,
    bucket: &str,
    source_key: &str,
    dest_key: &str,
) -> Result<(), AppError> {
    client
        .copy_object()
        .bucket(bucket)
        .key(dest_key)
        .copy_source(format!("{bucket}/{source_key}"))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn create_folder(client: &Client, bucket: &str, prefix: &str) -> Result<(), AppError> {
    let key = if prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    };
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(Vec::new()))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

/// Upload every planned part, returning the completed parts. On any failure the
/// caller is responsible for aborting the multipart upload.
async fn upload_parts(
    client: &Client,
    bucket: &str,
    key: &str,
    upload_id: &str,
    src_path: &str,
    ranges: &[(u64, u64)],
) -> Result<Vec<CompletedPart>, AppError> {
    let mut parts = Vec::with_capacity(ranges.len());
    for (i, (offset, len)) in ranges.iter().enumerate() {
        let part_number = (i as i32) + 1;
        let body = ByteStream::read_from()
            .path(src_path)
            .offset(*offset)
            .length(Length::Exact(*len))
            .build()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let out = client
            .upload_part()
            .bucket(bucket)
            .key(key)
            .upload_id(upload_id)
            .part_number(part_number)
            .body(body)
            .send()
            .await
            .map_err(map_sdk_err)?;
        parts.push(
            CompletedPart::builder()
                .part_number(part_number)
                .set_e_tag(out.e_tag().map(String::from))
                .build(),
        );
    }
    Ok(parts)
}

/// Upload a file from a local path. Files up to `CHUNK_SIZE` go through a single
/// `put_object`; larger files use multipart (8 MiB parts) and abort on failure.
pub async fn upload_file(
    client: &Client,
    bucket: &str,
    key: &str,
    src_path: &str,
) -> Result<(), AppError> {
    let meta = tokio::fs::metadata(src_path)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let total = meta.len();
    let content_type = guess_content_type(key);

    if !use_multipart(total, CHUNK_SIZE) {
        let body = ByteStream::from_path(src_path)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        client
            .put_object()
            .bucket(bucket)
            .key(key)
            .content_type(content_type)
            .body(body)
            .send()
            .await
            .map_err(map_sdk_err)?;
        return Ok(());
    }

    let create = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type(content_type)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let upload_id = create
        .upload_id()
        .ok_or_else(|| AppError::Internal("multipart upload id missing".into()))?
        .to_string();

    let ranges = split_ranges(total, CHUNK_SIZE);
    match upload_parts(client, bucket, key, &upload_id, src_path, &ranges).await {
        Ok(parts) => {
            client
                .complete_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .multipart_upload(
                    CompletedMultipartUpload::builder()
                        .set_parts(Some(parts))
                        .build(),
                )
                .send()
                .await
                .map_err(map_sdk_err)?;
            Ok(())
        }
        Err(e) => {
            let _ = client
                .abort_multipart_upload()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .send()
                .await;
            Err(e)
        }
    }
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

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_get_bucket_properties(
    profile: ConnectionProfile,
    bucket: String,
) -> Result<BucketProperties, AppError> {
    get_bucket_properties(&make_client(&profile), &bucket).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_set_versioning(
    profile: ConnectionProfile,
    bucket: String,
    enabled: bool,
) -> Result<(), AppError> {
    set_versioning(&make_client(&profile), &bucket, enabled).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_put_bucket_tagging(
    profile: ConnectionProfile,
    bucket: String,
    tags: Vec<TagKv>,
) -> Result<(), AppError> {
    put_bucket_tagging(&make_client(&profile), &bucket, tags).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_put_bucket_cors(
    profile: ConnectionProfile,
    bucket: String,
    cors_json: String,
) -> Result<(), AppError> {
    put_bucket_cors(&make_client(&profile), &bucket, &cors_json).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_put_bucket_policy(
    profile: ConnectionProfile,
    bucket: String,
    policy_json: String,
) -> Result<(), AppError> {
    put_bucket_policy(&make_client(&profile), &bucket, &policy_json).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_list_object_versions(
    profile: ConnectionProfile,
    bucket: String,
    prefix: String,
) -> Result<Vec<ObjectVersion>, AppError> {
    list_object_versions(&make_client(&profile), &bucket, &prefix).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_download_object_version(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
    version_id: String,
    dest_path: String,
) -> Result<(), AppError> {
    download_object_version(
        &make_client(&profile),
        &bucket,
        &key,
        &version_id,
        &dest_path,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_copy_object(
    profile: ConnectionProfile,
    bucket: String,
    source_key: String,
    dest_key: String,
) -> Result<(), AppError> {
    copy_object(&make_client(&profile), &bucket, &source_key, &dest_key).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_create_folder(
    profile: ConnectionProfile,
    bucket: String,
    prefix: String,
) -> Result<(), AppError> {
    create_folder(&make_client(&profile), &bucket, &prefix).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn s3_upload_file(
    profile: ConnectionProfile,
    bucket: String,
    key: String,
    src_path: String,
) -> Result<(), AppError> {
    upload_file(&make_client(&profile), &bucket, &key, &src_path).await
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

    #[test]
    fn exactly_chunk_size_is_single_put() {
        assert!(!use_multipart(CHUNK_SIZE, CHUNK_SIZE));
    }

    #[test]
    fn one_over_chunk_size_is_multipart() {
        assert!(use_multipart(CHUNK_SIZE + 1, CHUNK_SIZE));
    }

    #[test]
    fn split_ranges_one_over_chunk_yields_two_parts() {
        let ranges = split_ranges(CHUNK_SIZE + 1, CHUNK_SIZE);
        assert_eq!(ranges, vec![(0, CHUNK_SIZE), (CHUNK_SIZE, 1)]);
    }

    #[test]
    fn split_ranges_exact_multiple_has_no_trailing_zero() {
        let ranges = split_ranges(CHUNK_SIZE * 2, CHUNK_SIZE);
        assert_eq!(ranges, vec![(0, CHUNK_SIZE), (CHUNK_SIZE, CHUNK_SIZE)]);
    }

    #[test]
    fn split_ranges_below_chunk_is_single_range() {
        assert_eq!(split_ranges(100, CHUNK_SIZE), vec![(0, 100)]);
    }

    #[test]
    fn guess_content_type_covers_known_and_unknown() {
        assert_eq!(guess_content_type("a/b.txt"), "text/plain");
        assert_eq!(guess_content_type("data.JSON"), "application/json");
        assert_eq!(guess_content_type("photo.jpeg"), "image/jpeg");
        assert_eq!(guess_content_type("archive.tar.gz"), "application/gzip");
        assert_eq!(guess_content_type("noext"), "application/octet-stream");
        assert_eq!(
            guess_content_type("mystery.xyz"),
            "application/octet-stream"
        );
    }

    #[test]
    fn cors_json_round_trips_through_sdk_rules() {
        let json = r#"[{"allowedMethods":["GET","PUT"],"allowedOrigins":["*"],"allowedHeaders":["*"],"maxAgeSeconds":3600}]"#;
        let rules = json_to_cors_rules(json).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].allowed_methods(), ["GET", "PUT"]);
        let back = cors_rules_to_json(&rules).unwrap();
        let reparsed: Vec<CorsRuleJson> = serde_json::from_str(&back).unwrap();
        assert_eq!(reparsed[0].allowed_origins, vec!["*".to_string()]);
        assert_eq!(reparsed[0].max_age_seconds, Some(3600));
    }

    #[test]
    fn invalid_cors_json_is_validation_error() {
        let err = json_to_cors_rules("not json").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn bucket_properties_serializes_camel_case() {
        let p = BucketProperties {
            versioning: Some("Enabled".into()),
            tags: vec![TagKv {
                key: "env".into(),
                value: "dev".into(),
            }],
            cors_json: None,
            policy_json: Some("{}".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["versioning"], "Enabled");
        assert_eq!(v["tags"][0]["key"], "env");
        assert!(v["corsJson"].is_null());
        assert_eq!(v["policyJson"], "{}");
    }

    #[test]
    fn object_version_serializes_camel_case() {
        let ov = ObjectVersion {
            key: "a.txt".into(),
            version_id: "v1".into(),
            is_latest: true,
            delete_marker: false,
            size: Some(12),
            last_modified: Some("2026-07-14T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&ov).unwrap();
        assert_eq!(v["versionId"], "v1");
        assert_eq!(v["isLatest"], true);
        assert_eq!(v["deleteMarker"], false);
        assert_eq!(v["size"], 12);
    }
}
