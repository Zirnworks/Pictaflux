export type BlendMode = "source-over" | "multiply" | "screen" | "overlay";

export interface BrushState {
  size: number;
  color: string;
  opacity: number;
}

export interface BrushTip {
  name: string;
  bitmap: ImageBitmap;
  diameter: number;
  spacing: number;
}

export interface BrushDynamics {
  pressureSize: boolean;
  pressureOpacity: boolean;
  tiltAngle: boolean;
  sizeJitter: number;
  angleJitter: number;
}

export interface BrushPreset {
  id: string;
  name: string;
  tip: BrushTip;
  dynamics: BrushDynamics;
}

export interface DiffusionRequest {
  imageData: string;
  prompt: string;
}

export interface DiffusionResponse {
  imageData: string;
}
