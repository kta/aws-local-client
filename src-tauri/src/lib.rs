pub mod attr;
pub mod connections;
pub mod ddb;
pub mod error;

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
