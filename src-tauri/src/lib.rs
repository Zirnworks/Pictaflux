use tauri::Manager;

mod commands;
mod state;

#[cfg(target_os = "macos")]
mod tablet;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::new())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::process_canvas,
            commands::start_sidecar,
            commands::stop_sidecar,
            commands::get_sidecar_status,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            tablet::start_tablet_monitor(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_state = window.state::<state::AppState>();
                let mut child_to_kill = None;
                if let Ok(mut sidecar) = app_state.sidecar.lock() {
                    child_to_kill = sidecar.child.take();
                    sidecar.status = state::SidecarStatus::Stopped;
                };
                if let Some(mut child) = child_to_kill {
                    let _ = child.start_kill();
                    let _ = child.try_wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pictaflux");
}
