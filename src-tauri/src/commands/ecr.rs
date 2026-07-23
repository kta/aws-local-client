use aws_sdk_ecr::types::{ImageDetail, ImageIdentifier, Repository};
use aws_sdk_ecr::Client;
use aws_smithy_types::date_time::Format;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub name: String,
    pub uri: String,
    pub arn: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EcrImage {
    /// Image tag, if the image is tagged (untagged images have none).
    pub tag: Option<String>,
    pub digest: Option<String>,
    /// Size in bytes. `None` when the emulator only implements ListImages
    /// (tag+digest) and not the richer DescribeImages (e.g. kumo).
    pub size_bytes: Option<i64>,
    pub pushed_at: Option<String>,
}

fn make_client(p: &ConnectionProfile) -> Client {
    Client::new(&make_sdk_config(p))
}

fn to_summary(r: &Repository) -> RepositorySummary {
    RepositorySummary {
        name: r.repository_name().unwrap_or_default().to_string(),
        uri: r.repository_uri().unwrap_or_default().to_string(),
        arn: r.repository_arn().unwrap_or_default().to_string(),
        created_at: r.created_at().and_then(|dt| dt.fmt(Format::DateTime).ok()),
    }
}

fn from_image_detail(d: &ImageDetail) -> EcrImage {
    EcrImage {
        tag: d.image_tags().first().map(String::from),
        digest: d.image_digest().map(String::from),
        size_bytes: d.image_size_in_bytes(),
        pushed_at: d
            .image_pushed_at()
            .and_then(|dt| dt.fmt(Format::DateTime).ok()),
    }
}

fn from_image_id(id: &ImageIdentifier) -> EcrImage {
    EcrImage {
        tag: id.image_tag().map(String::from),
        digest: id.image_digest().map(String::from),
        size_bytes: None,
        pushed_at: None,
    }
}

/// True when an error message looks like the emulator does not implement the
/// operation (kumo answers DescribeImages with "The action DescribeImages is
/// not valid for this endpoint"). Mirrors the frontend detector.
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

pub async fn list_repositories(client: &Client) -> Result<Vec<RepositorySummary>, AppError> {
    let out = client
        .describe_repositories()
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out.repositories().iter().map(to_summary).collect())
}

pub async fn create_repository(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_repository()
        .repository_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_repository(client: &Client, name: &str, force: bool) -> Result<(), AppError> {
    client
        .delete_repository()
        .repository_name(name)
        .force(force)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

/// List the images in a repository. Prefers DescribeImages (tag/digest/size/
/// pushedAt); on emulators that do not implement it (kumo) it falls back to
/// ListImages, which returns tag+digest only.
pub async fn list_images(client: &Client, name: &str) -> Result<Vec<EcrImage>, AppError> {
    match client.describe_images().repository_name(name).send().await {
        Ok(out) => Ok(out.image_details().iter().map(from_image_detail).collect()),
        Err(e) => {
            let err = map_sdk_err(e);
            if is_unsupported_msg(&err.to_string()) {
                let out = client
                    .list_images()
                    .repository_name(name)
                    .send()
                    .await
                    .map_err(map_sdk_err)?;
                Ok(out.image_ids().iter().map(from_image_id).collect())
            } else {
                Err(err)
            }
        }
    }
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn ecr_list_repositories(
    profile: ConnectionProfile,
) -> Result<Vec<RepositorySummary>, AppError> {
    list_repositories(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecr_create_repository(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    create_repository(&make_client(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecr_delete_repository(
    profile: ConnectionProfile,
    name: String,
    force: bool,
) -> Result<(), AppError> {
    delete_repository(&make_client(&profile), &name, force).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ecr_list_images(
    profile: ConnectionProfile,
    name: String,
) -> Result<Vec<EcrImage>, AppError> {
    list_images(&make_client(&profile), &name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_summary_serializes_camel_case() {
        let s = RepositorySummary {
            name: "my-repo".into(),
            uri: "000000000000.dkr.ecr.ap-northeast-1.amazonaws.com/my-repo".into(),
            arn: "arn:aws:ecr:ap-northeast-1:000000000000:repository/my-repo".into(),
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["name"], "my-repo");
        assert_eq!(
            v["uri"],
            "000000000000.dkr.ecr.ap-northeast-1.amazonaws.com/my-repo"
        );
        assert_eq!(
            v["arn"],
            "arn:aws:ecr:ap-northeast-1:000000000000:repository/my-repo"
        );
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn ecr_image_serializes_camel_case() {
        let i = EcrImage {
            tag: Some("latest".into()),
            digest: Some("sha256:abc".into()),
            size_bytes: Some(1024),
            pushed_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&i).unwrap();
        assert_eq!(v["tag"], "latest");
        assert_eq!(v["digest"], "sha256:abc");
        assert_eq!(v["sizeBytes"], 1024);
        assert_eq!(v["pushedAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn ecr_image_serializes_null_optionals() {
        let i = EcrImage {
            tag: None,
            digest: Some("sha256:abc".into()),
            size_bytes: None,
            pushed_at: None,
        };
        let v = serde_json::to_value(&i).unwrap();
        assert!(v["tag"].is_null());
        assert_eq!(v["digest"], "sha256:abc");
        assert!(v["sizeBytes"].is_null());
        assert!(v["pushedAt"].is_null());
    }

    #[test]
    fn to_summary_maps_missing_fields_to_defaults() {
        let r = Repository::builder().repository_name("bare").build();
        let mapped = to_summary(&r);
        assert_eq!(mapped.name, "bare");
        assert_eq!(mapped.uri, "");
        assert_eq!(mapped.arn, "");
        assert!(mapped.created_at.is_none());
    }

    #[test]
    fn from_image_id_maps_tag_and_digest() {
        let id = ImageIdentifier::builder()
            .image_tag("v1")
            .image_digest("sha256:deadbeef")
            .build();
        let mapped = from_image_id(&id);
        assert_eq!(mapped.tag.as_deref(), Some("v1"));
        assert_eq!(mapped.digest.as_deref(), Some("sha256:deadbeef"));
        assert!(mapped.size_bytes.is_none());
        assert!(mapped.pushed_at.is_none());
    }

    #[test]
    fn from_image_detail_maps_first_tag_and_size() {
        let d = ImageDetail::builder()
            .image_tags("latest")
            .image_tags("v2")
            .image_digest("sha256:abc")
            .image_size_in_bytes(2048)
            .build();
        let mapped = from_image_detail(&d);
        assert_eq!(mapped.tag.as_deref(), Some("latest"));
        assert_eq!(mapped.digest.as_deref(), Some("sha256:abc"));
        assert_eq!(mapped.size_bytes, Some(2048));
    }

    #[test]
    fn detects_unsupported_operation_signatures() {
        assert!(is_unsupported_msg(
            "internal error: InvalidAction: The action DescribeImages is not valid for this endpoint"
        ));
        assert!(is_unsupported_msg(
            "API for service 'ecr' not yet implemented or pro feature"
        ));
        assert!(!is_unsupported_msg("not found: repository does not exist"));
    }
}
