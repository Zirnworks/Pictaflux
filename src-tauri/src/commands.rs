use crate::state::{AppState, SidecarStatus};
use std::process::Stdio;
use tauri::State;
use tokio::io::AsyncBufReadExt;

#[tauri::command]
pub fn process_canvas(
    image_base64: String,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    *state.last_prompt.lock().map_err(|e| e.to_string())? = prompt;
    Ok(image_base64)
}

#[derive(serde::Serialize)]
pub struct SidecarStartResult {
    pub port: u16,
}

#[tauri::command]
pub async fn start_sidecar(
    port: u16,
    prompt: String,
    feedback: f32,
    strength: f32,
    state: State<'_, AppState>,
) -> Result<SidecarStartResult, String> {
    // Check if already running
    {
        let sidecar = state.sidecar.lock().map_err(|e| e.to_string())?;
        if sidecar.child.is_some() {
            return Err("Sidecar is already running".into());
        }
    }

    // Safety net: kill any orphaned process on the target port (e.g. from
    // a previous crash or unclean shutdown).
    let _ = tokio::process::Command::new("lsof")
        .args(["-ti", &format!(":{}", port)])
        .output()
        .await
        .map(|output| {
            if let Ok(pids) = String::from_utf8(output.stdout) {
                for pid in pids.lines() {
                    if let Ok(pid) = pid.trim().parse::<u32>() {
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                    }
                }
            }
        });
    // Brief pause so the OS can release the socket
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Determine paths
    let sidecar_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("sidecar");
    let python_path = sidecar_dir.join(".venv/bin/python3");
    let script_path = sidecar_dir.join("diffusion_server.py");

    if !python_path.exists() {
        return Err(format!(
            "Python venv not found at {}. Run the sidecar setup first.",
            python_path.display()
        ));
    }
    if !script_path.exists() {
        return Err(format!(
            "Sidecar script not found at {}",
            script_path.display()
        ));
    }

    // Set status to Loading
    {
        let mut sidecar = state.sidecar.lock().map_err(|e| e.to_string())?;
        sidecar.status = SidecarStatus::Loading;
    }

    // Spawn the Python process
    let mut child = tokio::process::Command::new(&python_path)
        .arg(&script_path)
        .arg("--port")
        .arg(port.to_string())
        .arg("--prompt")
        .arg(&prompt)
        .arg("--feedback")
        .arg(feedback.to_string())
        .arg("--strength")
        .arg(strength.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Read stdout lines until READY:<port>
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture sidecar stdout")?;
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    // Wait for READY signal with timeout
    let ready_port = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[sidecar] {}", line);
            if let Some(port_str) = line.strip_prefix("READY:") {
                let p: u16 = port_str
                    .parse()
                    .map_err(|e| format!("Bad port in READY signal: {}", e))?;
                return Ok(p);
            }
        }
        Err("Sidecar exited before sending READY signal".to_string())
    })
    .await
    .map_err(|_| "Sidecar startup timed out after 120s".to_string())?
    .map_err(|e: String| e)?;

    // Store child in state
    {
        let mut sidecar = state.sidecar.lock().map_err(|e| e.to_string())?;
        sidecar.child = Some(child);
        sidecar.port = ready_port;
        sidecar.status = SidecarStatus::Ready;
    }

    Ok(SidecarStartResult { port: ready_port })
}

#[tauri::command]
pub async fn stop_sidecar(state: State<'_, AppState>) -> Result<(), String> {
    // Take the child out of the mutex before awaiting kill, to avoid
    // holding the lock across an await point.
    let mut child = {
        let mut sidecar = state.sidecar.lock().map_err(|e| e.to_string())?;
        sidecar.status = SidecarStatus::Stopped;
        sidecar.child.take()
    };
    if let Some(ref mut child) = child {
        // kill() sends SIGKILL and waits for exit, ensuring the port is
        // actually released before we return.
        let _ = child.kill().await;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SidecarStatusResponse {
    pub status: SidecarStatus,
    pub port: u16,
}

#[tauri::command]
pub fn get_sidecar_status(state: State<'_, AppState>) -> Result<SidecarStatusResponse, String> {
    let sidecar = state.sidecar.lock().map_err(|e| e.to_string())?;
    Ok(SidecarStatusResponse {
        status: sidecar.status.clone(),
        port: sidecar.port,
    })
}
