use tauri::Manager;

mod commands;
mod state;

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_state = window.state::<state::AppState>();
                let lock_result = app_state.sidecar.lock();
                if let Ok(mut sidecar) = lock_result {
                    if let Some(ref mut child) = sidecar.child {
                        let _ = child.start_kill();
                    }
                    sidecar.child = None;
                    sidecar.status = state::SidecarStatus::Stopped;
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pictaflux");
}
