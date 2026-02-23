export interface BrushState {
  size: number;
  color: string;
  opacity: number;
}

export interface DiffusionRequest {
  imageData: string;
  prompt: string;
}

export interface DiffusionResponse {
  imageData: string;
}
