pub mod attr;
pub mod connections;
pub mod ddb;
pub mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
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
            ddb::ddb_list_tables,
            ddb::ddb_describe_table,
            ddb::ddb_scan,
            ddb::ddb_query,
            ddb::ddb_put_item,
            ddb::ddb_delete_item,
            ddb::ddb_create_table,
            ddb::ddb_delete_table,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
