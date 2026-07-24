use aws_sdk_cognitoidentityprovider::types::{AttributeType, MessageActionType};
use aws_sdk_cognitoidentityprovider::Client;
use aws_smithy_types::date_time::Format;
use serde::Serialize;

use crate::connections::{make_sdk_config, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPoolSummary {
    pub id: String,
    pub name: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPoolDetail {
    pub id: String,
    pub name: String,
    pub estimated_users: i32,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CognitoUser {
    pub username: String,
    pub status: Option<String>,
    pub enabled: bool,
    pub email: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPoolClientSummary {
    pub client_id: String,
    pub client_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CognitoGroup {
    pub name: String,
    pub description: Option<String>,
}

fn iso(dt: Option<&aws_smithy_types::DateTime>) -> Option<String> {
    dt.and_then(|d| d.fmt(Format::DateTime).ok())
}

// ---- User pools ----

pub async fn list_user_pools(client: &Client) -> Result<Vec<UserPoolSummary>, AppError> {
    let out = client
        .list_user_pools()
        .max_results(60)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .user_pools()
        .iter()
        .map(|p| UserPoolSummary {
            id: p.id().unwrap_or_default().to_string(),
            name: p.name().unwrap_or_default().to_string(),
            created_at: iso(p.creation_date()),
        })
        .collect())
}

pub async fn create_user_pool(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .create_user_pool()
        .pool_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_user_pool(client: &Client, id: &str) -> Result<(), AppError> {
    client
        .delete_user_pool()
        .user_pool_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_user_pool(client: &Client, id: &str) -> Result<UserPoolDetail, AppError> {
    let out = client
        .describe_user_pool()
        .user_pool_id(id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let pool = out.user_pool();
    Ok(UserPoolDetail {
        id: pool.and_then(|p| p.id()).unwrap_or(id).to_string(),
        name: pool.and_then(|p| p.name()).unwrap_or_default().to_string(),
        estimated_users: pool.map(|p| p.estimated_number_of_users()).unwrap_or(0),
        created_at: iso(pool.and_then(|p| p.creation_date())),
    })
}

// ---- Users ----

pub async fn list_users(client: &Client, pool_id: &str) -> Result<Vec<CognitoUser>, AppError> {
    let out = client
        .list_users()
        .user_pool_id(pool_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .users()
        .iter()
        .map(|u| CognitoUser {
            username: u.username().unwrap_or_default().to_string(),
            status: u.user_status().map(|s| s.as_str().to_string()),
            enabled: u.enabled(),
            email: u
                .attributes()
                .iter()
                .find(|a| a.name() == "email")
                .and_then(|a| a.value())
                .map(String::from),
            created_at: iso(u.user_create_date()),
        })
        .collect())
}

pub async fn admin_create_user(
    client: &Client,
    pool_id: &str,
    username: &str,
    email: Option<&str>,
    temp_password: Option<&str>,
) -> Result<(), AppError> {
    let mut op = client
        .admin_create_user()
        .user_pool_id(pool_id)
        .username(username)
        // Suppress the (undeliverable) welcome message on local emulators.
        .message_action(MessageActionType::Suppress);
    if let Some(email) = email {
        if !email.is_empty() {
            let attr = AttributeType::builder()
                .name("email")
                .value(email)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            op = op.user_attributes(attr);
        }
    }
    if let Some(pw) = temp_password {
        if !pw.is_empty() {
            op = op.temporary_password(pw);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn admin_set_user_password(
    client: &Client,
    pool_id: &str,
    username: &str,
    password: &str,
    permanent: bool,
) -> Result<(), AppError> {
    client
        .admin_set_user_password()
        .user_pool_id(pool_id)
        .username(username)
        .password(password)
        .permanent(permanent)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn admin_enable_user(
    client: &Client,
    pool_id: &str,
    username: &str,
) -> Result<(), AppError> {
    client
        .admin_enable_user()
        .user_pool_id(pool_id)
        .username(username)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn admin_disable_user(
    client: &Client,
    pool_id: &str,
    username: &str,
) -> Result<(), AppError> {
    client
        .admin_disable_user()
        .user_pool_id(pool_id)
        .username(username)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn admin_delete_user(
    client: &Client,
    pool_id: &str,
    username: &str,
) -> Result<(), AppError> {
    client
        .admin_delete_user()
        .user_pool_id(pool_id)
        .username(username)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

// ---- App clients ----

pub async fn list_user_pool_clients(
    client: &Client,
    pool_id: &str,
) -> Result<Vec<UserPoolClientSummary>, AppError> {
    let out = client
        .list_user_pool_clients()
        .user_pool_id(pool_id)
        .max_results(60)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .user_pool_clients()
        .iter()
        .map(|c| UserPoolClientSummary {
            client_id: c.client_id().unwrap_or_default().to_string(),
            client_name: c.client_name().unwrap_or_default().to_string(),
        })
        .collect())
}

pub async fn create_user_pool_client(
    client: &Client,
    pool_id: &str,
    name: &str,
) -> Result<(), AppError> {
    client
        .create_user_pool_client()
        .user_pool_id(pool_id)
        .client_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_user_pool_client(
    client: &Client,
    pool_id: &str,
    client_id: &str,
) -> Result<(), AppError> {
    client
        .delete_user_pool_client()
        .user_pool_id(pool_id)
        .client_id(client_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

// ---- Groups ----

pub async fn list_groups(client: &Client, pool_id: &str) -> Result<Vec<CognitoGroup>, AppError> {
    let out = client
        .list_groups()
        .user_pool_id(pool_id)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(out
        .groups()
        .iter()
        .map(|g| CognitoGroup {
            name: g.group_name().unwrap_or_default().to_string(),
            description: g.description().map(String::from),
        })
        .collect())
}

pub async fn create_group(
    client: &Client,
    pool_id: &str,
    name: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    let mut op = client.create_group().user_pool_id(pool_id).group_name(name);
    if let Some(d) = description {
        if !d.is_empty() {
            op = op.description(d);
        }
    }
    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_group(client: &Client, pool_id: &str, name: &str) -> Result<(), AppError> {
    client
        .delete_group()
        .user_pool_id(pool_id)
        .group_name(name)
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
pub async fn cognito_list_user_pools(
    profile: ConnectionProfile,
) -> Result<Vec<UserPoolSummary>, AppError> {
    list_user_pools(&client_for(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_create_user_pool(
    profile: ConnectionProfile,
    name: String,
) -> Result<(), AppError> {
    create_user_pool(&client_for(&profile), &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_delete_user_pool(
    profile: ConnectionProfile,
    id: String,
) -> Result<(), AppError> {
    delete_user_pool(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_get_user_pool(
    profile: ConnectionProfile,
    id: String,
) -> Result<UserPoolDetail, AppError> {
    get_user_pool(&client_for(&profile), &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_list_users(
    profile: ConnectionProfile,
    pool_id: String,
) -> Result<Vec<CognitoUser>, AppError> {
    list_users(&client_for(&profile), &pool_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_admin_create_user(
    profile: ConnectionProfile,
    pool_id: String,
    username: String,
    email: Option<String>,
    temp_password: Option<String>,
) -> Result<(), AppError> {
    admin_create_user(
        &client_for(&profile),
        &pool_id,
        &username,
        email.as_deref(),
        temp_password.as_deref(),
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_admin_set_user_password(
    profile: ConnectionProfile,
    pool_id: String,
    username: String,
    password: String,
    permanent: bool,
) -> Result<(), AppError> {
    admin_set_user_password(
        &client_for(&profile),
        &pool_id,
        &username,
        &password,
        permanent,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_admin_enable_user(
    profile: ConnectionProfile,
    pool_id: String,
    username: String,
) -> Result<(), AppError> {
    admin_enable_user(&client_for(&profile), &pool_id, &username).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_admin_disable_user(
    profile: ConnectionProfile,
    pool_id: String,
    username: String,
) -> Result<(), AppError> {
    admin_disable_user(&client_for(&profile), &pool_id, &username).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_admin_delete_user(
    profile: ConnectionProfile,
    pool_id: String,
    username: String,
) -> Result<(), AppError> {
    admin_delete_user(&client_for(&profile), &pool_id, &username).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_list_user_pool_clients(
    profile: ConnectionProfile,
    pool_id: String,
) -> Result<Vec<UserPoolClientSummary>, AppError> {
    list_user_pool_clients(&client_for(&profile), &pool_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_create_user_pool_client(
    profile: ConnectionProfile,
    pool_id: String,
    name: String,
) -> Result<(), AppError> {
    create_user_pool_client(&client_for(&profile), &pool_id, &name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_delete_user_pool_client(
    profile: ConnectionProfile,
    pool_id: String,
    client_id: String,
) -> Result<(), AppError> {
    delete_user_pool_client(&client_for(&profile), &pool_id, &client_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_list_groups(
    profile: ConnectionProfile,
    pool_id: String,
) -> Result<Vec<CognitoGroup>, AppError> {
    list_groups(&client_for(&profile), &pool_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_create_group(
    profile: ConnectionProfile,
    pool_id: String,
    name: String,
    description: Option<String>,
) -> Result<(), AppError> {
    create_group(
        &client_for(&profile),
        &pool_id,
        &name,
        description.as_deref(),
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cognito_delete_group(
    profile: ConnectionProfile,
    pool_id: String,
    name: String,
) -> Result<(), AppError> {
    delete_group(&client_for(&profile), &pool_id, &name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_pool_summary_serializes_camel_case() {
        let s = UserPoolSummary {
            id: "ap-northeast-1_abc".into(),
            name: "my-pool".into(),
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "ap-northeast-1_abc");
        assert_eq!(v["name"], "my-pool");
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn user_pool_detail_serializes_camel_case() {
        let d = UserPoolDetail {
            id: "ap-northeast-1_abc".into(),
            name: "my-pool".into(),
            estimated_users: 3,
            created_at: None,
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["id"], "ap-northeast-1_abc");
        assert_eq!(v["estimatedUsers"], 3);
        assert!(v["createdAt"].is_null());
    }

    #[test]
    fn cognito_user_serializes_camel_case() {
        let u = CognitoUser {
            username: "alice".into(),
            status: Some("CONFIRMED".into()),
            enabled: true,
            email: Some("alice@example.com".into()),
            created_at: Some("2026-07-22T00:00:00Z".into()),
        };
        let v = serde_json::to_value(&u).unwrap();
        assert_eq!(v["username"], "alice");
        assert_eq!(v["status"], "CONFIRMED");
        assert_eq!(v["enabled"], true);
        assert_eq!(v["email"], "alice@example.com");
        assert_eq!(v["createdAt"], "2026-07-22T00:00:00Z");
    }

    #[test]
    fn user_pool_client_summary_serializes_camel_case() {
        let c = UserPoolClientSummary {
            client_id: "abc123".into(),
            client_name: "web-client".into(),
        };
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["clientId"], "abc123");
        assert_eq!(v["clientName"], "web-client");
    }

    #[test]
    fn cognito_group_serializes_camel_case() {
        let g = CognitoGroup {
            name: "admins".into(),
            description: Some("admin group".into()),
        };
        let v = serde_json::to_value(&g).unwrap();
        assert_eq!(v["name"], "admins");
        assert_eq!(v["description"], "admin group");

        let bare = CognitoGroup {
            name: "plain".into(),
            description: None,
        };
        let v = serde_json::to_value(&bare).unwrap();
        assert!(v["description"].is_null());
    }
}
