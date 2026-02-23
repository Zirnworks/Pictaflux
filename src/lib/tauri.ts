import { invoke } from "@tauri-apps/api/core";

export async function processCanvas(
  imageBase64: string,
  prompt: string,
): Promise<string> {
  return await invoke<string>("process_canvas", { imageBase64, prompt });
}

export interface SidecarStartResult {
  port: number;
}

export interface SidecarStatusResponse {
  status: "stopped" | "loading" | "ready" | { error: string };
  port: number;
}

export async function startSidecar(
  port: number,
  prompt: string,
  feedback: number,
): Promise<SidecarStartResult> {
  return await invoke<SidecarStartResult>("start_sidecar", {
    port,
    prompt,
    feedback,
  });
}

export async function stopSidecar(): Promise<void> {
  return await invoke<void>("stop_sidecar");
}

export async function getSidecarStatus(): Promise<SidecarStatusResponse> {
  return await invoke<SidecarStatusResponse>("get_sidecar_status");
}
