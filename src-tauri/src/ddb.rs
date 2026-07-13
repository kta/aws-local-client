use aws_sdk_dynamodb::types::{
    AttributeDefinition, GlobalSecondaryIndex, KeySchemaElement, KeyType, Projection,
    ProjectionType, ScalarAttributeType,
};
use aws_sdk_dynamodb::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::attr::{item_to_json, json_to_attr, json_to_item};
use crate::connections::{make_client, ConnectionProfile};
use crate::error::{map_sdk_err, AppError};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyDef {
    pub name: String,
    pub key_type: String,
    pub attr_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDetail {
    pub name: String,
    pub keys: Vec<KeyDef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    pub name: String,
    pub status: String,
    pub item_count: i64,
    pub size_bytes: i64,
    pub keys: Vec<KeyDef>,
    pub gsis: Vec<IndexDetail>,
    pub lsis: Vec<IndexDetail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub attr: String,
    pub op: String,
    pub value: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub table_name: String,
    pub limit: i32,
    pub start_key: Option<Value>,
    pub filter: Option<Filter>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkCondition {
    pub name: String,
    pub op: String,
    pub value: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub table_name: String,
    pub index_name: Option<String>,
    pub pk_name: String,
    pub pk_value: Value,
    pub sk: Option<SkCondition>,
    pub limit: i32,
    pub start_key: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResult {
    pub items: Vec<Value>,
    pub last_key: Option<Value>,
    pub count: i32,
    pub scanned_count: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyAttr {
    pub name: String,
    pub attr_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GsiSpec {
    pub name: String,
    pub pk: KeyAttr,
    pub sk: Option<KeyAttr>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableRequest {
    pub table_name: String,
    pub pk: KeyAttr,
    pub sk: Option<KeyAttr>,
    pub gsis: Vec<GsiSpec>,
}

pub async fn list_tables(client: &Client) -> Result<Vec<String>, AppError> {
    let mut names = vec![];
    let mut start: Option<String> = None;
    loop {
        let out = client
            .list_tables()
            .set_exclusive_start_table_name(start.clone())
            .send()
            .await
            .map_err(map_sdk_err)?;
        names.extend(out.table_names().iter().cloned());
        start = out.last_evaluated_table_name().map(String::from);
        if start.is_none() {
            break;
        }
    }
    Ok(names)
}

pub async fn describe_table(client: &Client, name: &str) -> Result<TableDetail, AppError> {
    let out = client
        .describe_table()
        .table_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let t = out
        .table()
        .ok_or_else(|| AppError::NotFound(format!("table {name} not found")))?;

    let attr_type = |attr_name: &str| -> String {
        t.attribute_definitions()
            .iter()
            .find(|d| d.attribute_name() == attr_name)
            .map(|d| d.attribute_type().as_str().to_string())
            .unwrap_or_else(|| "S".into())
    };
    let keys_of = |schema: &[KeySchemaElement]| -> Vec<KeyDef> {
        schema
            .iter()
            .map(|k| KeyDef {
                name: k.attribute_name().to_string(),
                key_type: k.key_type().as_str().to_string(),
                attr_type: attr_type(k.attribute_name()),
            })
            .collect()
    };

    Ok(TableDetail {
        name: t.table_name().unwrap_or(name).to_string(),
        status: t
            .table_status()
            .map(|s| s.as_str().to_string())
            .unwrap_or_default(),
        item_count: t.item_count().unwrap_or(0),
        size_bytes: t.table_size_bytes().unwrap_or(0),
        keys: keys_of(t.key_schema()),
        gsis: t
            .global_secondary_indexes()
            .iter()
            .map(|g| IndexDetail {
                name: g.index_name().unwrap_or_default().to_string(),
                keys: keys_of(g.key_schema()),
            })
            .collect(),
        lsis: t
            .local_secondary_indexes()
            .iter()
            .map(|l| IndexDetail {
                name: l.index_name().unwrap_or_default().to_string(),
                keys: keys_of(l.key_schema()),
            })
            .collect(),
    })
}

pub async fn scan(client: &Client, req: &ScanRequest) -> Result<PageResult, AppError> {
    let mut op = client.scan().table_name(&req.table_name).limit(req.limit);
    if let Some(f) = &req.filter {
        let av = json_to_attr(&f.value)?;
        let expr = match f.op.as_str() {
            "eq" => "#a = :v",
            "contains" => "contains(#a, :v)",
            other => return Err(AppError::Validation(format!("unknown filter op: {other}"))),
        };
        op = op
            .filter_expression(expr)
            .expression_attribute_names("#a", &f.attr)
            .expression_attribute_values(":v", av);
    }
    if let Some(k) = &req.start_key {
        op = op.set_exclusive_start_key(Some(json_to_item(k)?));
    }
    let out = op.send().await.map_err(map_sdk_err)?;
    Ok(PageResult {
        items: out.items().iter().map(item_to_json).collect(),
        last_key: out.last_evaluated_key().map(item_to_json),
        count: out.count(),
        scanned_count: out.scanned_count(),
    })
}

pub async fn query(client: &Client, req: &QueryRequest) -> Result<PageResult, AppError> {
    let mut expr = "#pk = :pk".to_string();
    let mut op = client
        .query()
        .table_name(&req.table_name)
        .limit(req.limit)
        .expression_attribute_names("#pk", &req.pk_name)
        .expression_attribute_values(":pk", json_to_attr(&req.pk_value)?);
    if let Some(idx) = &req.index_name {
        op = op.index_name(idx);
    }
    if let Some(sk) = &req.sk {
        let cond = match sk.op.as_str() {
            "eq" => "#sk = :sk",
            "begins_with" => "begins_with(#sk, :sk)",
            other => return Err(AppError::Validation(format!("unknown sk op: {other}"))),
        };
        expr = format!("{expr} AND {cond}");
        op = op
            .expression_attribute_names("#sk", &sk.name)
            .expression_attribute_values(":sk", json_to_attr(&sk.value)?);
    }
    if let Some(k) = &req.start_key {
        op = op.set_exclusive_start_key(Some(json_to_item(k)?));
    }
    let out = op
        .key_condition_expression(expr)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(PageResult {
        items: out.items().iter().map(item_to_json).collect(),
        last_key: out.last_evaluated_key().map(item_to_json),
        count: out.count(),
        scanned_count: out.scanned_count(),
    })
}

pub async fn put_item(client: &Client, table: &str, item: &Value) -> Result<(), AppError> {
    client
        .put_item()
        .table_name(table)
        .set_item(Some(json_to_item(item)?))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_item(client: &Client, table: &str, key: &Value) -> Result<(), AppError> {
    client
        .delete_item()
        .table_name(table)
        .set_key(Some(json_to_item(key)?))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn scalar_type(s: &str) -> Result<ScalarAttributeType, AppError> {
    match s {
        "S" => Ok(ScalarAttributeType::S),
        "N" => Ok(ScalarAttributeType::N),
        "B" => Ok(ScalarAttributeType::B),
        other => Err(AppError::Validation(format!("unknown attr type: {other}"))),
    }
}

pub async fn create_table(client: &Client, req: &CreateTableRequest) -> Result<(), AppError> {
    let mut attr_defs: Vec<AttributeDefinition> = vec![];
    let push_attr = |k: &KeyAttr, defs: &mut Vec<AttributeDefinition>| -> Result<(), AppError> {
        if defs.iter().any(|d| d.attribute_name() == k.name) {
            return Ok(());
        }
        defs.push(
            AttributeDefinition::builder()
                .attribute_name(&k.name)
                .attribute_type(scalar_type(&k.attr_type)?)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
        Ok(())
    };

    let key_schema =
        |pk: &KeyAttr, sk: &Option<KeyAttr>| -> Result<Vec<KeySchemaElement>, AppError> {
            let mut ks = vec![KeySchemaElement::builder()
                .attribute_name(&pk.name)
                .key_type(KeyType::Hash)
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?];
            if let Some(sk) = sk {
                ks.push(
                    KeySchemaElement::builder()
                        .attribute_name(&sk.name)
                        .key_type(KeyType::Range)
                        .build()
                        .map_err(|e| AppError::Internal(e.to_string()))?,
                );
            }
            Ok(ks)
        };

    push_attr(&req.pk, &mut attr_defs)?;
    if let Some(sk) = &req.sk {
        push_attr(sk, &mut attr_defs)?;
    }
    for g in &req.gsis {
        push_attr(&g.pk, &mut attr_defs)?;
        if let Some(sk) = &g.sk {
            push_attr(sk, &mut attr_defs)?;
        }
    }

    let mut op = client
        .create_table()
        .table_name(&req.table_name)
        .set_attribute_definitions(Some(attr_defs))
        .set_key_schema(Some(key_schema(&req.pk, &req.sk)?))
        .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest);

    for g in &req.gsis {
        op = op.global_secondary_indexes(
            GlobalSecondaryIndex::builder()
                .index_name(&g.name)
                .set_key_schema(Some(key_schema(&g.pk, &g.sk)?))
                .projection(
                    Projection::builder()
                        .projection_type(ProjectionType::All)
                        .build(),
                )
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
    }

    op.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_table(client: &Client, name: &str) -> Result<(), AppError> {
    client
        .delete_table()
        .table_name(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

// ---- Tauri commands ----

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_list_tables(profile: ConnectionProfile) -> Result<Vec<String>, AppError> {
    list_tables(&make_client(&profile)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_describe_table(
    profile: ConnectionProfile,
    table_name: String,
) -> Result<TableDetail, AppError> {
    describe_table(&make_client(&profile), &table_name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_scan(
    profile: ConnectionProfile,
    req: ScanRequest,
) -> Result<PageResult, AppError> {
    scan(&make_client(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_query(
    profile: ConnectionProfile,
    req: QueryRequest,
) -> Result<PageResult, AppError> {
    query(&make_client(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_put_item(
    profile: ConnectionProfile,
    table_name: String,
    item: Value,
) -> Result<(), AppError> {
    put_item(&make_client(&profile), &table_name, &item).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_delete_item(
    profile: ConnectionProfile,
    table_name: String,
    key: Value,
) -> Result<(), AppError> {
    delete_item(&make_client(&profile), &table_name, &key).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_create_table(
    profile: ConnectionProfile,
    req: CreateTableRequest,
) -> Result<(), AppError> {
    create_table(&make_client(&profile), &req).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ddb_delete_table(
    profile: ConnectionProfile,
    table_name: String,
) -> Result<(), AppError> {
    delete_table(&make_client(&profile), &table_name).await
}
