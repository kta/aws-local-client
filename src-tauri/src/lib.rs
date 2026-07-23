pub mod attr;
pub mod commands;
pub mod connections;
pub mod error;

// Back-compat re-export so existing call sites / integration tests referring to
// `app_lib::ddb` keep resolving after the move to `commands::dynamodb`.
pub use commands::dynamodb as ddb;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The WebdriverIO E2E plugins are only wired up when the app is launched by
    // the wdio embedded driver, which sets TAURI_WEBDRIVER_PORT. They register
    // their own global logger, so they must NOT coexist with tauri-plugin-log
    // (that panics with "attempted to set a logger after the logging system was
    // already initialized"). Gating both on this env keeps normal `tauri dev`
    // using tauri-plugin-log while E2E runs use the wdio plugins instead.
    let under_wdio = cfg!(debug_assertions) && std::env::var_os("TAURI_WEBDRIVER_PORT").is_some();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(debug_assertions)]
    if under_wdio {
        // tauri-plugin-wdio-webdriver starts an embedded W3C WebDriver server so
        // macOS can be driven without an external tauri-driver / CrabNebula.
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if cfg!(debug_assertions) && !under_wdio {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connections::list_connections,
            connections::save_connection,
            connections::delete_connection,
            connections::detect_connections,
            commands::dynamodb::ddb_list_tables,
            commands::dynamodb::ddb_describe_table,
            commands::dynamodb::ddb_scan,
            commands::dynamodb::ddb_query,
            commands::dynamodb::ddb_put_item,
            commands::dynamodb::ddb_delete_item,
            commands::dynamodb::ddb_create_table,
            commands::dynamodb::ddb_delete_table,
            commands::dynamodb::ddb_execute_statement,
            commands::dynamodb::ddb_list_backups,
            commands::dynamodb::ddb_create_backup,
            commands::dynamodb::ddb_delete_backup,
            commands::dynamodb::ddb_restore_backup,
            commands::sqs::sqs_list_queues,
            commands::sqs::sqs_get_queue,
            commands::sqs::sqs_create_queue,
            commands::sqs::sqs_delete_queue,
            commands::sqs::sqs_set_queue_attributes,
            commands::sqs::sqs_send_message,
            commands::sqs::sqs_receive_messages,
            commands::sqs::sqs_delete_message,
            commands::sqs::sqs_purge_queue,
            commands::sqs::sqs_list_queue_tags,
            commands::sqs::sqs_tag_queue,
            commands::sqs::sqs_untag_queue,
            commands::sqs::sqs_list_dlq_sources,
            commands::sns::sns_list_topics,
            commands::sns::sns_create_topic,
            commands::sns::sns_delete_topic,
            commands::sns::sns_list_subscriptions,
            commands::sns::sns_subscribe_sqs,
            commands::sns::sns_unsubscribe,
            commands::sns::sns_publish,
            commands::sns::sns_get_topic_attributes,
            commands::sns::sns_set_display_name,
            commands::sns::sns_list_all_subscriptions,
            commands::sns::sns_list_topic_tags,
            commands::sns::sns_tag_topic,
            commands::sns::sns_untag_topic,
            commands::s3::s3_list_buckets,
            commands::s3::s3_create_bucket,
            commands::s3::s3_delete_bucket,
            commands::s3::s3_list_objects,
            commands::s3::s3_head_object,
            commands::s3::s3_put_object,
            commands::s3::s3_download_object,
            commands::s3::s3_delete_object,
            commands::s3::s3_get_bucket_properties,
            commands::s3::s3_set_versioning,
            commands::s3::s3_put_bucket_tagging,
            commands::s3::s3_put_bucket_cors,
            commands::s3::s3_put_bucket_policy,
            commands::s3::s3_list_object_versions,
            commands::s3::s3_download_object_version,
            commands::s3::s3_copy_object,
            commands::s3::s3_create_folder,
            commands::s3::s3_upload_file,
            commands::rds::rds_list_instances,
            commands::rds::rds_create_instance,
            commands::rds::rds_delete_instance,
            commands::rds::rds_stop_instance,
            commands::rds::rds_start_instance,
            commands::rds::rds_reboot_instance,
            commands::rds::rds_modify_instance,
            commands::rds::rds_list_snapshots,
            commands::rds::rds_create_snapshot,
            commands::rds::rds_restore_snapshot,
            commands::rds::rds_delete_snapshot,
            commands::rds::rds_list_parameter_groups,
            commands::rds::rds_create_parameter_group,
            commands::rds::rds_delete_parameter_group,
            commands::rds::rds_list_parameters,
            commands::ecr::ecr_list_repositories,
            commands::ecr::ecr_create_repository,
            commands::ecr::ecr_delete_repository,
            commands::ecr::ecr_list_images,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
