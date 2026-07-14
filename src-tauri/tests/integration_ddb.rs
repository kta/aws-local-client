//! Requires: docker run -d -p 8000:8000 amazon/dynamodb-local
//! Run with: cargo test -- --ignored

use app_lib::connections::{make_client, ConnectionProfile};
use app_lib::ddb::*;
use serde_json::json;

fn local_profile() -> ConnectionProfile {
    let endpoint_url =
        std::env::var("DDB_ENDPOINT").unwrap_or_else(|_| "http://localhost:8000".into());
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

#[tokio::test]
#[ignore]
async fn full_lifecycle_create_put_query_scan_delete() {
    let client = make_client(&local_profile());
    let table = "it_users";

    // cleanup from previous runs
    let _ = delete_table(&client, table).await;

    create_table(
        &client,
        &CreateTableRequest {
            table_name: table.into(),
            pk: KeyAttr {
                name: "pk".into(),
                attr_type: "S".into(),
            },
            sk: Some(KeyAttr {
                name: "sk".into(),
                attr_type: "S".into(),
            }),
            gsis: vec![GsiSpec {
                name: "by_email".into(),
                pk: KeyAttr {
                    name: "email".into(),
                    attr_type: "S".into(),
                },
                sk: None,
            }],
        },
    )
    .await
    .unwrap();

    assert!(list_tables(&client)
        .await
        .unwrap()
        .contains(&table.to_string()));

    let detail = describe_table(&client, table).await.unwrap();
    assert_eq!(detail.keys.len(), 2);
    assert_eq!(detail.gsis.len(), 1);

    for i in 0..3 {
        put_item(
            &client,
            table,
            &json!({
                "pk": {"S": "user#1"},
                "sk": {"S": format!("order#{i}")},
                "email": {"S": "a@example.com"},
                "amount": {"N": i.to_string()},
            }),
        )
        .await
        .unwrap();
    }

    // scan with filter
    let page = scan(
        &client,
        &ScanRequest {
            table_name: table.into(),
            limit: 10,
            start_key: None,
            filter: Some(Filter {
                attr: "amount".into(),
                op: "eq".into(),
                value: json!({"N": "1"}),
            }),
        },
    )
    .await
    .unwrap();
    assert_eq!(page.count, 1);

    // query pk + begins_with
    let page = query(
        &client,
        &QueryRequest {
            table_name: table.into(),
            index_name: None,
            pk_name: "pk".into(),
            pk_value: json!({"S": "user#1"}),
            sk: Some(SkCondition {
                name: "sk".into(),
                op: "begins_with".into(),
                value: json!({"S": "order#"}),
            }),
            limit: 10,
            start_key: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.count, 3);

    // pagination: limit 2 then continue
    let p1 = scan(
        &client,
        &ScanRequest {
            table_name: table.into(),
            limit: 2,
            start_key: None,
            filter: None,
        },
    )
    .await
    .unwrap();
    assert!(p1.last_key.is_some());
    let p2 = scan(
        &client,
        &ScanRequest {
            table_name: table.into(),
            limit: 10,
            start_key: p1.last_key.clone(),
            filter: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(p1.count + p2.count, 3);

    // delete one item
    delete_item(
        &client,
        table,
        &json!({"pk": {"S": "user#1"}, "sk": {"S": "order#0"}}),
    )
    .await
    .unwrap();
    let page = scan(
        &client,
        &ScanRequest {
            table_name: table.into(),
            limit: 10,
            start_key: None,
            filter: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(page.count, 2);

    delete_table(&client, table).await.unwrap();
    assert!(!list_tables(&client)
        .await
        .unwrap()
        .contains(&table.to_string()));
}

#[tokio::test]
#[ignore]
async fn describe_missing_table_is_not_found() {
    let client = make_client(&local_profile());
    let err = describe_table(&client, "no_such_table").await.unwrap_err();
    assert!(matches!(err, app_lib::error::AppError::NotFound(_)));
}

/// Returns true when an emulator does not implement the backup API family.
/// dynamodb-local / localstack return "UnknownOperationException", floci returns
/// a "not supported" message. In that case the backup tests pass by asserting
/// this error shape instead of exercising the full flow.
fn is_unsupported(err: &app_lib::error::AppError) -> bool {
    let msg = err.to_string();
    msg.contains("UnknownOperation") || msg.contains("not supported")
}

#[tokio::test]
#[ignore]
async fn execute_statement_partiql_insert_and_select() {
    let client = make_client(&local_profile());
    let table = "it_partiql";

    let _ = delete_table(&client, table).await;
    create_table(
        &client,
        &CreateTableRequest {
            table_name: table.into(),
            pk: KeyAttr {
                name: "pk".into(),
                attr_type: "S".into(),
            },
            sk: None,
            gsis: vec![],
        },
    )
    .await
    .unwrap();

    // INSERT via PartiQL: non-SELECT statements return no items.
    let inserted = execute_statement(
        &client,
        &format!(r#"INSERT INTO "{table}" VALUE {{'pk': 'user#1', 'name': 'Alice'}}"#),
        None,
    )
    .await
    .unwrap();
    assert!(inserted.items.is_empty());

    // SELECT returns the item as DynamoDB JSON.
    let selected = execute_statement(
        &client,
        &format!(r#"SELECT * FROM "{table}" WHERE pk = 'user#1'"#),
        None,
    )
    .await
    .unwrap();
    assert_eq!(selected.items.len(), 1);
    assert_eq!(selected.items[0]["pk"], json!({"S": "user#1"}));
    assert_eq!(selected.items[0]["name"], json!({"S": "Alice"}));

    delete_table(&client, table).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn backup_create_list_restore_delete() {
    let client = make_client(&local_profile());
    let table = "it_backup_src";
    let restored = "it_backup_restored";

    let _ = delete_table(&client, table).await;
    let _ = delete_table(&client, restored).await;
    create_table(
        &client,
        &CreateTableRequest {
            table_name: table.into(),
            pk: KeyAttr {
                name: "pk".into(),
                attr_type: "S".into(),
            },
            sk: None,
            gsis: vec![],
        },
    )
    .await
    .unwrap();
    put_item(&client, table, &json!({"pk": {"S": "user#1"}}))
        .await
        .unwrap();

    let backup_name = "it_backup";
    match create_backup(&client, table, backup_name).await {
        Ok(()) => {}
        Err(e) if is_unsupported(&e) => {
            // Emulator without backup support: assert the error shape and stop.
            delete_table(&client, table).await.unwrap();
            return;
        }
        Err(e) => panic!("unexpected create_backup error: {e}"),
    }

    // The backup appears in the list with a resolvable ARN.
    let backups = list_backups(&client).await.unwrap();
    let summary = backups
        .iter()
        .find(|b| b.table_name == table && b.backup_name == backup_name)
        .expect("created backup should be listed");
    let arn = summary.backup_arn.clone();
    assert!(!arn.is_empty());

    // Restore to a new table and confirm the item came back.
    restore_backup(&client, &arn, restored).await.unwrap();
    // Restore can take a moment to make the table queryable.
    let mut scanned = 0;
    for _ in 0..20 {
        match scan(
            &client,
            &ScanRequest {
                table_name: restored.into(),
                limit: 10,
                start_key: None,
                filter: None,
            },
        )
        .await
        {
            Ok(page) if page.count > 0 => {
                scanned = page.count;
                break;
            }
            _ => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
        }
    }
    assert_eq!(
        scanned, 1,
        "restored table should contain the backed-up item"
    );

    delete_backup(&client, &arn).await.unwrap();
    delete_table(&client, table).await.unwrap();
    let _ = delete_table(&client, restored).await;
}
