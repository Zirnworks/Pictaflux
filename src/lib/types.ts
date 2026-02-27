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

// Control source for a dynamics parameter
export type DynamicsControl =
  | "off"
  | "pressure"
  | "tilt"
  | "direction"
  | "fade";

export interface DynamicsController {
  control: DynamicsControl;
  jitter: number; // 0-1
  minimum: number; // 0-1 (floor value when controlled)
  fadeSteps: number; // steps for fade mode
}

export interface BrushDynamics {
  // Shape dynamics
  size: DynamicsController;
  angle: DynamicsController;
  roundness: DynamicsController;

  // Scatter
  scatterEnabled: boolean;
  scatter: DynamicsController;
  scatterCount: number; // stamps per placement
  scatterBothAxes: boolean;

  // Transfer
  opacity: DynamicsController;
  flow: DynamicsController;

  // Tip properties (from ABR Brsh object or manual settings)
  spacing: number; // 0-10 (fraction of diameter)
  tipAngle: number; // radians
  tipRoundness: number; // 0-1
  flipX: boolean;
  flipY: boolean;
  hardness: number; // 0-1 (computedBrush)
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
