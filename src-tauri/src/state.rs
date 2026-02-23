use std::sync::Mutex;

pub struct SidecarState {
    pub child: Option<tokio::process::Child>,
    pub port: u16,
    pub status: SidecarStatus,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SidecarStatus {
    Stopped,
    Loading,
    Ready,
    Error(String),
}

pub struct AppState {
    pub last_prompt: Mutex<String>,
    pub sidecar: Mutex<SidecarState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            last_prompt: Mutex::new(String::new()),
            sidecar: Mutex::new(SidecarState {
                child: None,
                port: 9824,
                status: SidecarStatus::Stopped,
            }),
        }
    }
}
